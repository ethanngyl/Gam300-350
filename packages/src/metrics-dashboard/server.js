/*!************************************************************************
\file server.js
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Standalone Express server for the Pipeline Metrics dashboard. It is a
separate application from the main web app: it never touches the
reconstruction backend, it only reads the metrics files that
backend/metrics.js writes, and serves the dashboard's built frontend.
Read-only by design, and bound to localhost unless METRICS_HOST says
otherwise, because the records name the host machine and its hardware.
- loadRecords()
Async. Reads every <jobsDir>/<id>_out/metrics.json plus the rolling
<jobsDir>/metrics.jsonl, merges them by jobId (the per-job file wins, the
.jsonl keeps records whose job folder was deleted) and sorts newest first.
- isRecord(value)
Shape check so a half-written or foreign JSON file can't break the API.
- GET /api/health
Liveness probe: { ok, uptimeSec }.
- GET /api/metrics
{ generatedAt, count, sources, records[] } for every run.
- GET /api/metrics/:jobId
One run's record, or 404.
Environment: METRICS_PORT (5010), METRICS_HOST (127.0.0.1),
METRICS_JOBS_DIR (falls back to JOBS_DIR, then ../backend/jobs).
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import express from 'express'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Same file names as backend/metrics.js. Not imported from there: that would
// pull in backend/config.js, which probes COLMAP / Brush on load.
const METRICS_FILE = 'metrics.json'
const METRICS_LOG = 'metrics.jsonl'
const JOB_ID_RE = /^[A-Za-z0-9-]{1,64}$/

const PORT = Number(process.env.METRICS_PORT) || 5010
const HOST = process.env.METRICS_HOST || '127.0.0.1'
const JOBS_DIR = path.resolve(
  process.env.METRICS_JOBS_DIR || process.env.JOBS_DIR || path.join(__dirname, '..', 'backend', 'jobs'),
)
const DIST_DIR = path.join(__dirname, 'dist')

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    True if value looks like a record written by backend/metrics.js.
*/
/************************************************************************/
function isRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.jobId === 'string' &&
    typeof value.finishedAt === 'string' &&
    typeof value.timing === 'object'
  )
}

/************************************************************************/
/*!
  \brief
    Parse JSON, returning null instead of throwing.
*/
/************************************************************************/
function tryParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/************************************************************************/
/*!
  \brief
    Collect every metrics record on disk. Missing folders or unreadable
    files are skipped -- the dashboard shows what it can.
  \return
    Promise of { records[], sources: { files, log, invalid } }.
*/
/************************************************************************/
async function loadRecords() {
  const byId = new Map()
  const sources = { files: 0, log: 0, invalid: 0 }

  // Rolling log first, so the per-job files below overwrite its entries.
  try {
    const log = await fsp.readFile(path.join(JOBS_DIR, METRICS_LOG), 'utf8')
    for (const line of log.split(/\r?\n/)) {
      if (!line.trim()) continue
      const rec = tryParse(line)
      if (isRecord(rec)) {
        byId.set(rec.jobId, rec)
        sources.log++
      } else sources.invalid++
    }
  } catch {
    // No runs finished yet.
  }

  let entries = []
  try {
    entries = await fsp.readdir(JOBS_DIR, { withFileTypes: true })
  } catch {
    // Jobs folder doesn't exist yet.
  }
  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && e.name.endsWith('_out'))
      .map(async (e) => {
        try {
          const rec = tryParse(await fsp.readFile(path.join(JOBS_DIR, e.name, METRICS_FILE), 'utf8'))
          if (isRecord(rec)) {
            byId.set(rec.jobId, rec)
            sources.files++
          } else sources.invalid++
        } catch {
          // Job still running or failed before metrics were written.
        }
      }),
  )

  const records = [...byId.values()].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
  return { records, sources }
}

// ----- End of Functions ----------------------------------------------------- //

const app = express()
app.disable('x-powered-by')

app.use('/api', (req, res, next) => {
  // Metrics change whenever a job finishes; never serve a stale copy.
  res.set('Cache-Control', 'no-store')
  next()
})

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptimeSec: Math.round(process.uptime()) })
})

app.get('/api/metrics', async (req, res) => {
  const { records, sources } = await loadRecords()
  res.json({ generatedAt: new Date().toISOString(), count: records.length, sources, records })
})

app.get('/api/metrics/:jobId', async (req, res) => {
  if (!JOB_ID_RE.test(req.params.jobId)) return res.status(400).json({ error: 'Invalid job id' })
  const { records } = await loadRecords()
  const rec = records.find((r) => r.jobId === req.params.jobId)
  if (!rec) return res.status(404).json({ error: 'No metrics for that job' })
  res.json(rec)
})

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))

// Built frontend (npm run metrics:build). In dev, Vite serves it instead.
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: 'index.html' }))
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next()
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
} else {
  app.get('/', (req, res) =>
    res.type('text').send('Dashboard not built. Run "npm run metrics:build", or "npm run metrics:dev" for development.'),
  )
}

// Express only treats a middleware as an error handler if it takes 4 args.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[metrics] ${req.method} ${req.url}: ${err.message}`)
  res.status(500).json({ error: 'Internal error' })
})

app.listen(PORT, HOST, () => {
  console.log(`[metrics] dashboard on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  console.log(`[metrics] reading ${JOBS_DIR}`)
})
