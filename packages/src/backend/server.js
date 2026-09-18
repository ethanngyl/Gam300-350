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
import { jobs, makeJob, runPipeline } from './pipeline.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.PORT || 5005

fs.mkdirSync(config.jobsDir, { recursive: true })

const app = express()

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
  runPipeline(job) // fire-and-forget; do not await
  res.status(202).json({ id: job.id, imageCount: files.length })
})

// Poll a job's status (bounded log tail, not the full log).
app.get('/jobs/:id', (req, res) => {
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

// Download / stream the finished splat .ply.
app.get('/jobs/:id/result.ply', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job || job.status !== 'done' || !job.resultPath) {
    return res.status(404).json({ error: 'result not ready' })
  }
  res.setHeader('Content-Type', 'application/octet-stream')
  res.sendFile(job.resultPath)
})

app.listen(PORT, () => {
  console.log(`[backend] http://localhost:${PORT}`)
  console.log(`[backend] COLMAP: ${config.colmapBin}`)
  console.log(`[backend] Brush:  ${config.brushBin}`)
  console.log(`[backend] jobs:   ${config.jobsDir}`)
})
