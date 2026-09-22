// Backend: serves the built React app and runs the photo -> COLMAP -> Brush ->
// Gaussian splat .ply pipeline. Upload handling + pipeline engine live in
// ./pipeline.js and ./config.js (ported from the standalone server/).

import crypto from 'node:crypto'
import fs from 'node:fs'
import path, { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import express from 'express'
import multer from 'multer'

import { config } from './config.js'
import {
  cancelJob,
  canonicalYoutubeUrl,
  jobs,
  killChildren,
  makeJob,
  restoreJob,
  runPipeline,
  runYoutubePipeline,
} from './pipeline.js'
import { IMAGE_EXT_RE, scanJob, scanJobs } from './scan.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.PORT || 5005

fs.mkdirSync(config.jobsDir, { recursive: true })

// Jobs live in memory, so rebuild them from the job folders on disk. Without
// this, everything finished before a restart 404s on /jobs/:id and result.ply.
const restored = await scanJobs(config.jobsDir)
for (const record of restored) if (!jobs.has(record.id)) restoreJob(record)
console.log(`[backend] restored ${restored.length} job(s) from ${config.jobsDir}`)

// A job from memory, else adopted from its folder on disk (e.g. a folder that
// appeared after startup). null if there is no such job.
async function getJob(id) {
  const live = jobs.get(id)
  if (live) return live
  const record = await scanJob(id)
  return record ? (jobs.get(id) ?? restoreJob(record)) : null
}

const app = express()

// Parse JSON bodies (used by /jobs/from-youtube). Only applies to
// application/json requests, so the multipart photo upload is unaffected.
app.use(express.json())

// Serve the built React frontend (run `npm run build` to produce web-app/dist).
app.use(express.static(path.join(__dirname, '../web-app/dist')))

// --- Upload handling --------------------------------------------------------
// Assign a job id up front so every file in the request lands in one job folder.
function assignJobId(req, _res, next) {
  req.jobId = crypto.randomUUID()
  req._fileIdx = 0
  fs.mkdirSync(path.join(config.jobsDir, req.jobId, 'images'), { recursive: true })
  next()
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) =>
    cb(null, path.join(config.jobsDir, req.jobId, 'images')),
  filename: (req, file, cb) => {
    // Stable ordered names -- COLMAP doesn't care about the original name.
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase()
    cb(null, `${String(req._fileIdx++).padStart(4, '0')}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSizeMB * 1024 * 1024, files: config.maxFiles },
  fileFilter: (_req, file, cb) =>
    cb(null, /^image\/(jpe?g|png)$/i.test(file.mimetype)),
})

// Content-level guard: multer's fileFilter only trusts the client-declared MIME
// type. This re-inspects the actual bytes of every uploaded file and rejects the
// whole batch (deleting the job folder) if any file isn't a real JPEG/PNG.
async function onlyImages(req, res, next) {
  const files = req.files || []
  if (files.length === 0) return next()

  try {
    const { fileTypeFromBuffer } = await import('file-type')
    const legalMimes = ['image/jpeg', 'image/png']

    for (const file of files) {
      const buffer = fs.readFileSync(file.path)
      const type = await fileTypeFromBuffer(buffer)

      if (!type || !legalMimes.includes(type.mime)) {
        // Reject the batch: remove the job folder created up front by assignJobId.
        fs.rmSync(path.join(config.jobsDir, req.jobId), { recursive: true, force: true })
        return res.status(400).json({
          error: 'Invalid file content -- only real JPEG or PNG images are accepted.',
          detected: type ? type.mime : 'unknown',
        })
      }
    }

    next()
  } catch (err) {
    next(err)
  }
}

// --- Routes -----------------------------------------------------------------
// Create a reconstruction job from uploaded photos. Returns a job id immediately
// and runs COLMAP + Brush in the background -- the frontend polls for status.
app.post('/upload', assignJobId, upload.array('images', config.maxFiles), onlyImages, (req, res) => {
  const files = req.files || []
  if (files.length < 8) {
    return res.status(400).json({
      error: `Need at least 8 photos (got ${files.length}). More overlapping photos = better reconstruction.`,
    })
  }
  const job = makeJob(req.jobId)
  job.imageCount = files.length
  //runPipeline(job) // fire-and-forget; do not await
  res.status(202).json({ id: job.id, imageCount: files.length })
})

// List every job folder that has images, newest first. The folders on disk are
// scanned on each call (see scan.js), so photos and results from before a
// restart -- or dropped in by hand -- show up. A job that is live in memory
// keeps its live status: the disk can't tell "running" from "interrupted".
app.get('/jobs', async (_req, res) => {
  const records = await scanJobs(config.jobsDir)
  res.json(
    records.map((record) => {
      const job = jobs.get(record.id) ?? restoreJob(record)
      return {
        id: record.id,
        status: job.status,
        phase: job.phase,
        progress: job.progress,
        detail: job.detail,
        error: job.error,
        createdAt: record.createdAt,
        imageCount: record.imageCount,
        hasResult: job.status === 'done' && !!job.resultPath,
        thumbnail: record.thumbnail,
        images: record.images,
      }
    }),
  )
})

// Serve a single uploaded image. id/name are whitelisted to plain filename
// characters so a request can't use `..` or slashes to escape the jobs folder.
app.get('/jobs/:id/images/:name', (req, res) => {
  const { id, name } = req.params
  if (!/^[\w-]+$/.test(id) || !/^[\w.-]+$/.test(name) || !IMAGE_EXT_RE.test(name)) {
    return res.status(404).json({ error: 'image not found' })
  }
  res.sendFile(path.join(config.jobsDir, id, 'images', name), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'image not found' })
  })
})
// Create a reconstruction job from a YouTube link. Frames are extracted server
// side (tools/youtube_frames.py) into the job's images/ folder, then the same
// COLMAP + Brush pipeline runs. Body: { url: string, fps?: number, maxFrames?: number }
app.post('/jobs/from-youtube', (req, res) => {
  const { url, fps, maxFrames } = req.body || {}
  // Only single YouTube videos; the canonical form drops any playlist params.
  const videoUrl = canonicalYoutubeUrl(url)
  if (!videoUrl) {
    return res.status(400).json({
      error: 'Please use a link to a single YouTube video (youtube.com/watch?v=…, youtu.be/…, or youtube.com/shorts/…).',
    })
  }

  const jobId = crypto.randomUUID()
  fs.mkdirSync(path.join(config.jobsDir, jobId, 'images'), { recursive: true })
  const job = makeJob(jobId)
  job.source = 'youtube'

  const opts = {}
  if (Number.isFinite(Number(fps)) && Number(fps) > 0) {
    opts.fps = Math.min(Number(fps), config.ytMaxFps)
  }
  if (Number.isFinite(Number(maxFrames)) && Number(maxFrames) > 0) {
    opts.maxFrames = Math.min(Number(maxFrames), config.maxFiles)
  }

  runYoutubePipeline(job, videoUrl, opts) // fire-and-forget; the frontend polls /jobs/:id
  res.status(202).json({ id: job.id })
})

// Poll a job's status (bounded log tail, not the full log).
app.get('/jobs/:id', async (req, res) => {
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })
  res.json({
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    detail: job.detail,
    error: job.error,
    imageCount: job.imageCount ?? null,
    hasResult: job.status === 'done' && !!job.resultPath,
    logTail: job.log.slice(-40),
  })
})

// Cancel a running job: kills its COLMAP / Brush / python process so the GPU
// is freed immediately. Idempotent; a finished job answers 409.
app.delete('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })
  if (job.status === 'cancelled') return res.json({ id: job.id, status: job.status })
  if (!cancelJob(job)) {
    return res.status(409).json({ error: `job already ${job.status}` })
  }
  res.json({ id: job.id, status: job.status })
})

// Download / stream the finished splat .ply.
app.get('/jobs/:id/result.ply', async (req, res) => {
  const job = await getJob(req.params.id)
  if (!job || job.status !== 'done' || !job.resultPath) {
    return res.status(404).json({ error: 'result not ready' })
  }
  res.setHeader('Content-Type', 'application/octet-stream')
  res.sendFile(job.resultPath)
})

// --- Shutdown -----------------------------------------------------------------
// Tool processes (COLMAP / Brush / python) outlive this process unless we stop
// them explicitly. Kill them on every exit path so a Ctrl+C, a closed console
// window, a nodemon restart or a crash never leaves Brush training as an
// orphan on the GPU. Jobs live in memory only, so nothing else needs saving.
let shuttingDown = false
function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[backend] ${reason} -- stopping running tool processes`)
  for (const job of jobs.values()) {
    if (job.status === 'running') {
      job.status = 'error'
      job.error = 'Server shut down during processing.'
    }
  }
  killChildren()
  process.exit(exitCode)
}

// SIGINT: Ctrl+C. SIGTERM: nodemon / task manager / kill. SIGBREAK: Ctrl+Break
// on Windows. SIGHUP: the console window was closed (Windows maps
// CTRL_CLOSE_EVENT to it and gives the process a few seconds to react).
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  process.on(sig, () => shutdown(`received ${sig}`))
}
process.on('uncaughtException', (err) => {
  console.error('[backend] uncaught exception:', err)
  shutdown('crashed', 1)
})
process.on('unhandledRejection', (err) => {
  console.error('[backend] unhandled rejection:', err)
  shutdown('crashed', 1)
})
// Last resort for exit paths that bypass the handlers above (e.g. an explicit
// process.exit elsewhere). killChildren() is synchronous, so it works here.
process.on('exit', () => killChildren())

app.listen(PORT, () => {
  console.log(`[backend] http://localhost:${PORT}`)
  console.log(`[backend] COLMAP: ${config.colmapBin}`)
  console.log(`[backend] Brush:  ${config.brushBin}`)
  console.log(`[backend] jobs:   ${config.jobsDir}`)
})
