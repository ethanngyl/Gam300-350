import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import { config } from './config.js'
import { jobs, makeJob, runPipeline, runYoutubePipeline } from './pipeline.js'

fs.mkdirSync(config.jobsDir, { recursive: true })

const app = express()
app.use(express.json())

// --- Upload handling ---------------------------------------------------------
// Assign a job id up front so all files in the request land in one job folder.
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
    // Stable, safe, ordered names — COLMAP doesn't care about the original name.
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

// --- Routes ------------------------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Create a reconstruction job from uploaded photos.
app.post('/api/jobs', assignJobId, upload.array('photos', config.maxFiles), (req, res) => {
  const files = req.files || []
  if (files.length < 8) {
    return res.status(400).json({
      error: `Need at least 8 photos (got ${files.length}). More overlapping photos = better reconstruction.`,
    })
  }
  const job = makeJob(req.jobId)
  job.imageCount = files.length
  // Kick off the pipeline in the background; respond immediately.
  runPipeline(job)
  res.status(202).json({ id: job.id, imageCount: files.length })
})

// Create a reconstruction job from a YouTube link. Frames are extracted server
// side into the job's images/ folder, then the normal pipeline runs.
// Body: { url: string, fps?: number, maxFrames?: number }
app.post('/api/jobs/from-youtube', (req, res) => {
  const { url, fps, maxFrames } = req.body || {}
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid http(s) YouTube URL is required.' })
  }
  if (!/(youtube\.com|youtu\.be)/i.test(url)) {
    return res.status(400).json({ error: 'URL does not look like a YouTube link.' })
  }

  const jobId = crypto.randomUUID()
  fs.mkdirSync(path.join(config.jobsDir, jobId, 'images'), { recursive: true })
  const job = makeJob(jobId)
  job.source = 'youtube'

  const opts = {}
  if (Number.isFinite(Number(fps)) && Number(fps) > 0) opts.fps = Number(fps)
  if (Number.isFinite(Number(maxFrames)) && Number(maxFrames) > 0) {
    opts.maxFrames = Math.min(Number(maxFrames), config.maxFiles)
  }

  // Extract + reconstruct in the background; respond immediately.
  runYoutubePipeline(job, url, opts)
  res.status(202).json({ id: job.id })
})

// Poll a job's status. Returns a bounded log tail, not the full log.
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })
  res.json({
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    error: job.error,
    imageCount: job.imageCount ?? null,
    hasResult: job.status === 'done' && !!job.resultPath,
    logTail: job.log.slice(-40),
  })
})

// List all jobs (newest first).
app.get('/api/jobs', (_req, res) => {
  const list = [...jobs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((j) => ({
      id: j.id,
      status: j.status,
      phase: j.phase,
      progress: j.progress,
      createdAt: j.createdAt,
    }))
  res.json(list)
})

// Download / stream the finished splat .ply.
app.get('/api/jobs/:id/result.ply', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job || job.status !== 'done' || !job.resultPath) {
    return res.status(404).json({ error: 'result not ready' })
  }
  res.setHeader('Content-Type', 'application/octet-stream')
  res.sendFile(job.resultPath)
})

app.listen(config.port, () => {
  console.log(`[gsplat-server] listening on http://localhost:${config.port}`)
  console.log(`[gsplat-server] COLMAP: ${config.colmapBin}`)
  console.log(`[gsplat-server] Brush:  ${config.brushBin}`)
  console.log(`[gsplat-server] jobs:   ${config.jobsDir}`)
})
