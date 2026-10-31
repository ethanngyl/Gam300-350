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
Async. Reads every <jobsDir>/<id>/metrics.json (or legacy <id>_out/) plus the rolling
<jobsDir>/metrics.jsonl, merges them by jobId (the per-job file wins, the
.jsonl keeps records whose job folder was deleted), rebuilds a partial record
from <id>/status.json for finished jobs with no metrics file, and sorts
newest first.
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

// Same file names as backend/metrics.js and status.js. Not imported: that would
// pull in backend/config.js, which probes COLMAP / Brush on load.
const METRICS_FILE = 'metrics.json'
const METRICS_LOG = 'metrics.jsonl'
const STATUS_FILE = 'status.json'
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
    Read a file as JSON, or null if it's missing or not valid JSON.
*/
/************************************************************************/
async function readJson(file) {
  try {
    return tryParse(await fsp.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/************************************************************************/
/*!
  \brief
    Size of a file in bytes, or null if it can't be stat'ed.
*/
/************************************************************************/
async function fileSize(file) {
  try {
    return (await fsp.stat(file)).size
  } catch {
    return null
  }
}

/************************************************************************/
/*!
  \brief
    { format, vertexCount, properties } from a .ply header, or null.
    Same parse as backend/metrics.js readPlyHeader().
*/
/************************************************************************/
async function readPlyHeader(file) {
  let fh
  try {
    fh = await fsp.open(file, 'r')
    const buf = Buffer.alloc(64 * 1024)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    const text = buf.subarray(0, bytesRead).toString('latin1')
    const end = text.indexOf('end_header')
    if (!text.startsWith('ply') || end < 0) return null
    let vertexCount = null
    let inVertex = false
    let format = null
    const properties = []
    for (const line of text.slice(0, end).split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts[0] === 'format') format = parts[1]
      else if (parts[0] === 'element') {
        inVertex = parts[1] === 'vertex'
        if (inVertex) vertexCount = Number(parts[2])
      } else if (parts[0] === 'property' && inVertex) properties.push(parts.at(-1))
    }
    return { format, vertexCount, properties }
  } catch {
    return null
  } finally {
    await fh?.close()
  }
}

/************************************************************************/
/*!
  \brief
    Build a partial record for a finished job that has no metrics.json
    (it ran before metrics logging existed) from <id>/status.json and its
    .ply. Phase timings and hardware weren't recorded, so they stay null;
    totalSec is created -> last status update, upload/queue time included.
  \param id
    The job folder name
  \param status
    The parsed status.json
  \return
    Promise of the record, or null if the job isn't done.
*/
/************************************************************************/
async function recordFromStatus(id, status) {
  if (status?.id !== id || status.status !== 'done' || !status.createdAt) return null

  const outDir = path.join(JOBS_DIR, `${id}_out`)
  let outFiles = []
  try {
    outFiles = await fsp.readdir(outDir)
  } catch {
    // Output folder removed; fall back to what status.json says.
  }
  // Brush exports splat_<step>.ply; the highest step is the last one trained.
  const steps = outFiles.map((f) => /^splat_(\d+)\.ply$/.exec(f)).filter(Boolean)
  const rawName = steps.sort((a, b) => Number(b[1]) - Number(a[1]))[0]
  const lastStep = rawName ? Number(rawName[1]) : null
  const rawPly = rawName ? path.join(outDir, rawName[0]) : null
  const finalPly = status.result ? path.join(JOBS_DIR, status.result) : rawPly

  let sparseModels = null
  try {
    sparseModels = (await fsp.readdir(path.join(JOBS_DIR, id, 'sparse'), { withFileTypes: true })).filter((e) =>
      e.isDirectory(),
    ).length
  } catch {
    // No sparse folder.
  }

  const [header, rawBytes, finalBytes] = await Promise.all([
    finalPly ? readPlyHeader(finalPly) : null,
    rawPly ? fileSize(rawPly) : null,
    finalPly ? fileSize(finalPly) : null,
  ])
  const rel = (file) => (file ? path.relative(JOBS_DIR, file).split(path.sep).join('/') : null)
  const finishedAt = status.updatedAt ?? status.createdAt
  const sinceCreatedSec = Math.round((finishedAt - status.createdAt) / 100) / 10

  return {
    version: 1,
    jobId: id,
    // Marks a record rebuilt from status.json rather than written by metrics.js.
    derivedFrom: 'status.json',
    source: status.source ?? null,
    createdAt: new Date(status.createdAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    timing: { totalSec: sinceCreatedSec, sinceCreatedSec, colmapSec: null, trainingSec: null, phasesSec: {} },
    training: { iterationsTarget: lastStep, lastIterationLogged: lastStep, itersPerSec: null, maxResolution: null },
    input: { imageCount: status.imageCount ?? null, sparseModels },
    output: {
      splatCount: header?.vertexCount ?? null,
      plyFormat: header?.format ?? null,
      propertiesPerSplat: header?.properties.length ?? null,
      rawPlyBytes: rawBytes,
      finalPlyBytes: finalBytes,
      normalized: path.basename(finalPly ?? '') === 'result.ply',
      rawPly: rel(rawPly),
      finalPly: rel(finalPly),
    },
    gpuDuringTraining: null,
    hardware: null,
  }
}

/************************************************************************/
/*!
  \brief
    Collect every metrics record on disk. Per job, in order of preference:
    <id>/metrics.json, the legacy <id>_out/metrics.json, its line in
    metrics.jsonl, then a partial record rebuilt from <id>/status.json.
    Missing folders or unreadable files are skipped -- the dashboard shows
    what it can.
  \return
    Promise of { records[], sources: { files, log, status, invalid } }.
*/
/************************************************************************/
async function loadRecords() {
  const byId = new Map()
  const sources = { files: 0, log: 0, status: 0, invalid: 0 }

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
      .filter((e) => e.isDirectory() && JOB_ID_RE.test(e.name) && !e.name.endsWith('_out'))
      .map(async (e) => {
        const id = e.name
        for (const file of [path.join(JOBS_DIR, id, METRICS_FILE), path.join(JOBS_DIR, `${id}_out`, METRICS_FILE)]) {
          const rec = await readJson(file)
          if (rec === null) continue
          if (isRecord(rec)) {
            byId.set(rec.jobId, rec)
            sources.files++
            return
          }
          sources.invalid++
        }
        if (byId.has(id)) return // kept from metrics.jsonl
        // Job still running, failed, or finished before metrics were logged.
        const rec = await recordFromStatus(id, await readJson(path.join(JOBS_DIR, id, STATUS_FILE)))
        if (rec) {
          byId.set(id, rec)
          sources.status++
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
