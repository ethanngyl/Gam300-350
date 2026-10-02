/*!************************************************************************
\file server.js
\author1 Gabriel Sebastian Putra
\author2 Ethan Ng
\par DP email1: gabrielsebastian.p@digipen.edu
\par DP email2: 
\par Course: csd3401f26
\par Software Engineering Project 5
\date 29-09-2026
\brief
This source file is the Express backend that serves the built React frontend 
of the website and exposes a HTTP API for a pipeline to turn either a group
of photos or a youtube video into Gaussian Splat .ply file, using COLMAP and 
Brush. The actual work is done in the other files, "config.js, status.js, 
scan.js, pipeline.js", this file focuses on startup, shutdown and HTTP 
matters.
- getJod(id)
Returns the job from the in-memory jobs map. If it isn't there, it looks for 
the job's folder on disk (scanJob) and adopts it with restoreJob. This covers 
folders that appeared after startup. Returns null if the job doesn't exist.
- assigneJobId(req, res, next)
Runs before multer. Generates a UUID job ID, resets a file counter on req, 
and creates jobs/<id>/images/, so every file in the request goes into the same 
job folder.
- storage(multer diskStorage)
Destination sends files to the job's images/ folder. filename renames them in 
order (0000.jpg, 0001.png, …) and keeps the lowercased extension, defaulting 
to .jpg.
- upload(multer instance)
Applies size and count limits from config and accepts only files whose 
declared MIME type is JPEG or PNG.
- onlyImages(req, res, next)
Reads each uploaded file's bytes and checks the real type with file-type. If 
any file isn't really a JPEG or PNG, it deletes the whole job folder and 
returns 400. This guards against a client that lies about the MIME type.
- shutdown(reason, exitCode)
Runs only once. Marks every running job as error and saves it, calls 
killChildren() to stop the COLMAP/Brush/python processes, then exits.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import multer from 'multer'
import express from 'express'
import crypto from 'node:crypto'
import { config } from './config.js'
import { saveJob } from './status.js'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'
import 
{ 
  IMAGE_EXT_RE, JOB_ID_RE, scanJob, 
  scanJobs
} 
from './scan.js'
import 
{ 
  cancelJob, canonicalYoutubeUrl, jobs,
  killChildren, makeJob, restoreJob,
  runPipeline, runYoutubePipeline,
} 
from './pipeline.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

fs.mkdirSync(config.jobsDir, { recursive: true })

// Jobs live in memory, so rebuild them from the job folders on disk. Without
// this, everything finished before a restart 404s on /jobs/:id and result.ply.
const restored = await scanJobs(config.jobsDir)

// Folder where the wiki repo was cloned
// os.homedir() rather than $HOME: Windows doesn't set HOME.
const WIKI_DIR = path.join(os.homedir(), 'wiki')

for (const record of restored) 
{
  if (!jobs.has(record.id)) 
  {
      restoreJob(record)
  }
}

console.log(`[backend] restored ${restored.length} job(s) from ${config.jobsDir}`)

const app = express()

// Parse JSON bodies (used by /jobs/from-youtube). Only applies to
// application/json requests, so the multipart photo upload is unaffected.
app.use(express.json())

// Serve the built React frontend (run `npm run build` to produce web-app/dist).
app.use(express.static(path.join(__dirname, '../web-app/dist')))

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Gets a job from memory, else adopted from its folder on disk (e.g. a 
    folder that appeared after startup). null if there is no such job.
  \param id
  string
    The id of the job
  \return job
  returns the job from the jobs map, null if job doesn't exist.
*/
/************************************************************************/
async function getJob(id) 
{
  const live = jobs.get(id)

  if (live) 
    return live

  const record = await scanJob(id)

  return record ? (jobs.get(id) ?? restoreJob(record)) : null
}

// --- Upload handling --------------------------------------------------------
// Assign a job id up front so every file in the request lands in one job folder.
/************************************************************************/
/*!
  \brief
    Assign a job id up front so every file in the request lands in one job 
    folder. Must run before multer
  \param req
    The request from the user
  \param _res
    The response from the backend
  \param next
    moving on
  \return 
    ensures the file in the request goes into the same job folder
*/
/************************************************************************/
function assignJobId(req, _res, next) 
{
  req.jobId = crypto.randomUUID()
  req._fileIdx = 0
  fs.mkdirSync(path.join(config.jobsDir, req.jobId, 'images'), { recursive: true })
  next()
}

/************************************************************************/
/*!
  \brief
    Send files into the images folder and rename the images in order.
  \return 
    The image files default to jpg
*/
/************************************************************************/
const storage = multer.diskStorage
({
  destination: (req, _file, cb) => cb(null, path.join(config.jobsDir, req.jobId, 'images')),

  filename: (req, file, cb) => 
  {
    // Stable ordered names -- COLMAP doesn't care about the original name.
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase()
    cb(null, `${String(req._fileIdx++).padStart(4, '0')}${ext}`)
  },
})

/************************************************************************/
/*!
  \brief
    Make sures that only jpegs and pngs under a size limit is accepted.
  \return 
    nothing
*/
/************************************************************************/
const upload = multer
({
  storage,
  limits: { fileSize: config.maxFileSizeMB * 1024 * 1024, files: config.maxFiles },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpe?g|png)$/i.test(file.mimetype))
})

/************************************************************************/
/*!
  \brief
    Content-level guard: multer's fileFilter only trusts the client-declared 
    MIME type. This re-inspects the actual bytes of every uploaded file and 
    rejects the whole batch (deleting the job folder) if any file isn't a 
    real JPEG/PNG.
  \param req
    The request from the user
  \param res
    The response from the backend
  \param next
    moving on
  \return 
    400 if file isn't jpeg or png and deletes job folder.
*/
/************************************************************************/
async function onlyImages(req, res, next)
{
  const files = req.files || []
  if (files.length === 0) return next()

  try 
  {
    const { fileTypeFromFile } = await import('file-type')
    const legalMimes = ['image/jpeg', 'image/png']

    for (const file of files) 
    {
      const type = await fileTypeFromFile(file.path)      

      if (!type || !legalMimes.includes(type.mime)) 
      {
        // Reject the batch: remove the job folder created up front by assignJobId.
        await fs.promises.rm(path.join(config.jobsDir, req.jobId), { recursive: true, force: true })
        return res.status(400).json
        ({
          error: 'Invalid file content -- only real JPEG or PNG images are accepted.',
          detected: type ? type.mime : 'unknown',
        })
      }
    }

    next()
  } catch (err) 
  {
    next(err)
  }
}

// --- Shutdown -----------------------------------------------------------------
let shuttingDown = false

/************************************************************************/
/*!
  \brief
    Tool processes (COLMAP / Brush / python) outlive this process unless we 
    stop them explicitly. Kill them on every exit path so a Ctrl+C, a closed 
    console window, a nodemon restart or a crash never leaves Brush training 
    as an orphan on the GPU.
  \param reason
    string
    The type of shutdown
  \param exitCode
    number
    The code to exit the website
  \return 
    Exits the website
*/
/************************************************************************/
function shutdown(reason, exitCode = 0) 
{
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[backend] ${reason} -- stopping running tool processes`)
  for (const job of jobs.values()) 
  {
    if (job.status === 'running') 
    {
      job.status = 'error'
      job.error = 'Server shut down during processing.'
      saveJob(job)
    }
  }
  killChildren()
  process.exit(exitCode)
}

// ----- End of Functions ----------------------------------------------------- //

// ----- Start of Routes ------------------------------------------------------ // 

/************************************************************************/
/*!
  \brief
    Create a reconstruction job from uploaded photos. Returns a job id 
    immediately and runs COLMAP + Brush in the background -- the frontend 
    polls for status.
  \return 
    400 if less than 8 photos given, 202 if successful
*/
/************************************************************************/
app.post('/upload', assignJobId, upload.array('images', config.maxFiles), onlyImages, (req, res) => 
{
  const files = req.files || []
  if (files.length < 8)
  {
    // Reject cleanly: remove the job folder assignJobId created up front so a
    // too-small batch doesn't leave an orphan folder behind (same as onlyImages).
    fs.rmSync(path.join(config.jobsDir, req.jobId), { recursive: true, force: true })
    return res.status(400).json
    ({
      error: `Need at least 8 photos (got ${files.length}). More overlapping photos = better reconstruction.`,
    })
  }
  const job = makeJob(req.jobId)
  job.imageCount = files.length
  job.source = 'upload'
  saveJob(job) // gives upload-only jobs a status record from the start
  runPipeline(job) // fire-and-forget; do not await
  res.status(202).json({ id: job.id, imageCount: files.length })
})

/************************************************************************/
/*!
  \brief
    List every job folder that has images, newest first. The folders on 
    disk are scanned on each call (see scan.js), so photos and results from 
    before a restart -- or dropped in by hand -- show up. A job that is 
    live in memory keeps its live status: the disk can't tell "running" 
    from "interrupted".
  \return 
    A reecord of every job's details 
*/
/************************************************************************/
app.get('/jobs', async (_req, res) => 
{
  const records = await scanJobs(config.jobsDir)
  res.json
  (
    records.map((record) => 
    {
      const job = jobs.get(record.id) ?? restoreJob(record);
      return {
        id: record.id,
        status: job.status,
        phase: job.phase,
        progress: job.progress,
        detail: job.detail,
        error: job.error,
        createdAt: record.createdAt,
        updatedAt: job.updatedAt ?? record.updatedAt,
        imageCount: record.imageCount,
        hasResult: job.status === 'done' && !!job.resultPath,
        thumbnail: record.thumbnail,
        images: record.images,
      }
    }),
  )
})

/************************************************************************/
/*!
  \brief
    Serve a single uploaded image. id/name are whitelisted to plain filename
    characters so a request can't use `..` or slashes to escape the jobs 
    folder.
  \return 
    404 if image doesn't exist or else the image itself
*/
/************************************************************************/
app.get('/jobs/:id/images/:name', (req, res) => 
{
  const { id, name } = req.params
  if (!JOB_ID_RE.test(id) || !/^[\w.-]+$/.test(name) || !IMAGE_EXT_RE.test(name)) 
  {
    return res.status(404).json({ error: 'image not found' })
  }
  res.sendFile(path.join(config.jobsDir, id, 'images', name), (err) => 
  {
    if (err && !res.headersSent) res.status(404).json({ error: 'image not found' })
  })
})

/************************************************************************/
/*!
  \brief
    Create a reconstruction job from a YouTube link. Frames are extracted 
    server side (tools/youtube_frames.py) into the job's images/ folder, 
    then the same COLMAP + Brush pipeline runs. Body: { url: string, fps?: 
    number, maxFrames?: number }
  \return 
    400 if url doesn't work, else 202 and starts a job and runs youtube
    pipeline
*/
/************************************************************************/
app.post('/jobs/from-youtube', (req, res) => 
{
  const { url, fps, maxFrames } = req.body || {}
  // Only single YouTube videos; the canonical form drops any playlist params.
  const videoUrl = canonicalYoutubeUrl(url)
  if (!videoUrl) 
  {
    return res.status(400).json
    ({
      error: 'Please use a link to a single YouTube video (youtube.com/watch?v=…, youtu.be/…, or youtube.com/shorts/…).',
    })
  }

  const jobId = crypto.randomUUID()
  fs.mkdirSync(path.join(config.jobsDir, jobId, 'images'), { recursive: true })
  const job = makeJob(jobId)
  job.source = 'youtube'
  saveJob(job)

  const opts = {}
  if (Number.isFinite(Number(fps)) && Number(fps) > 0) 
  {
    opts.fps = Math.min(Number(fps), config.ytMaxFps)
  }
  if (Number.isFinite(Number(maxFrames)) && Number(maxFrames) > 0) 
  {
    opts.maxFrames = Math.min(Number(maxFrames), config.maxFiles)
  }

  runYoutubePipeline(job, videoUrl, opts) // fire-and-forget; the frontend polls /jobs/:id
  res.status(202).json({ id: job.id })
})

/************************************************************************/
/*!
  \brief
    Poll a job's status (bounded log tail, not the full log).
  \return 
    404 if job not found
    else status, phase, progress, error and the last 40 log lines
*/
/************************************************************************/
app.get('/jobs/:id', async (req, res) => 
{
  const job = await getJob(req.params.id)
  if (!job) 
    return res.status(404).json({ error: 'job not found' })
  res.json
  ({
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    detail: job.detail,
    error: job.error,
    updatedAt: job.updatedAt ?? null,
    imageCount: job.imageCount ?? null,
    hasResult: job.status === 'done' && !!job.resultPath,
    logTail: job.log.slice(-40),
  })
})

/************************************************************************/
/*!
  \brief
    Cancel a running job: kills its COLMAP / Brush / python process so the 
    GPU is freed immediately. Idempotent; a finished job answers 409.
  \return 
    404 if job not found
    409 if job is finished
    kills processes and frees GPU
*/
/************************************************************************/
app.delete('/jobs/:id', async (req, res) => 
{
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })
  if (job.status === 'cancelled') return res.json({ id: job.id, status: job.status })
  if (!cancelJob(job)) 
  {
    return res.status(409).json({ error: `job already ${job.status}` })
  }
  res.json({ id: job.id, status: job.status })
})

/************************************************************************/
/*!
  \brief
    Download / stream the finished splat .ply.
  \return 
    404 if result is not ready
*/
/************************************************************************/
app.get('/jobs/:id/result.ply', async (req, res) => 
{
  const job = await getJob(req.params.id)
  if (!job || job.status !== 'done' || !job.resultPath) 
  {
    return res.status(404).json({ error: 'result not ready' })
  }
  res.setHeader('Content-Type', 'application/octet-stream')
  res.sendFile(job.resultPath)
})

// /wiki with no page → show Home
app.get('/wiki', (req, res) => serveWikiPage('Home', res))

// /wiki/SomePage → show that page
app.get('/wiki/:page', (req, res) => serveWikiPage(req.params.page, res))

// shared helper
function serveWikiPage(rawPage, res) {
  // CHANGE 1 — convert spaces to hyphens BEFORE stripping,
  // so "Technical Requirements" → "Technical-Requirements" (matches the .md filename)
  const page = rawPage
    .replace(/\s+/g, '-')             // spaces → hyphens
    .replace(/[^a-zA-Z0-9_-]/g, '')   // then strip anything else (blocks ../ etc.)

  const filePath = path.join(WIKI_DIR, `${page}.md`)

  fs.readFile(filePath, 'utf8', (err, markdown) => {
    if (err) return res.status(404).send('Wiki page not found')

    // CHANGE 2 — note: 'let' not 'const', because we modify html next
    let html = marked(markdown)

    // Rewrite bare wiki links (href="Architecture") → href="/wiki/Architecture".
    // Leaves external (http://), absolute (/), and anchor (#) links untouched.
    html = html.replace(/href="(?!https?:\/\/|\/|#)([^"]+)"/g, 'href="/wiki/$1"')

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>${page} — Wiki</title>
          <style>
            body { max-width: 800px; margin: 40px auto; padding: 0 20px;
                   font-family: system-ui, sans-serif; line-height: 1.6; }
            pre { background: #f4f4f4; padding: 12px; overflow-x: auto; }
            code { background: #f4f4f4; padding: 2px 4px; }
            a { color: #0366d6; }
          </style>
        </head>
        <body>${html}</body>
      </html>
    `)
  })
}

// ----- End of Routes -------------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    JSON error handler (must be last, and take 4 args so Express treats it
    as an error handler). Without it, multer's upload-limit errors and any
    error passed to next(err) fall through to Express's default handler,
    which replies with an HTML 500 -- the frontend does res.json() on that
    and can only show a generic message. Here each case becomes a JSON
    { error } with the right status, so the upload UI can show something
    useful ("that file is too big"), and the job folder assignJobId created
    up front is cleaned up so a rejected upload leaves nothing behind.
  \param err
    The error passed on from a route or from multer.
  \param req
    The request (carries req.jobId for the folder cleanup).
  \param res
    The response.
  \param _next
    Express's next (unused, but required for the 4-arg signature).
  \return
    Sends a JSON error response; delegates to Express if a reply already
    started streaming.
*/
/************************************************************************/
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // A partial reply is already on the wire -- let Express finish/abort it.
  if (res.headersSent) return _next(err)

  // Clean up the empty job folder assignJobId made before multer ran, so a
  // rejected upload doesn't leave a stray folder that scanJobs would skip
  // anyway (no images) but that still clutters jobs/. Best-effort.
  if (req.jobId) {
    try {
      fs.rmSync(path.join(config.jobsDir, req.jobId), { recursive: true, force: true })
    } catch {
      // Nothing to clean up, or it's already gone.
    }
  }

  if (err instanceof multer.MulterError) {
    // The limits come from config (maxFileSizeMB, maxFiles); keep the messages
    // in sync with those so they stay true if the limits change.
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(413).json({
          error: `That file is too large -- each photo must be under ${config.maxFileSizeMB} MB.`,
        })
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_PART_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          error: `Too many files -- upload at most ${config.maxFiles} photos at once.`,
        })
      default:
        return res.status(400).json({ error: `Upload rejected: ${err.message}.` })
    }
  }

  // Anything else (e.g. onlyImages' fs failure) is a real server-side fault.
  console.error('[backend] request error:', err)
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' })
})

// SIGINT: Ctrl+C. SIGTERM: nodemon / task manager / kill. SIGBREAK: Ctrl+Break
// on Windows. SIGHUP: the console window was closed (Windows maps
// CTRL_CLOSE_EVENT to it and gives the process a few seconds to react).
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) 
{
  process.on(sig, () => shutdown(`received ${sig}`))
}
process.on('uncaughtException', (err) => 
{
  console.error('[backend] uncaught exception:', err)
  shutdown('crashed', 1)
})
process.on('unhandledRejection', (err) => 
{
  console.error('[backend] unhandled rejection:', err)
  shutdown('crashed', 1)
})
// Last resort for exit paths that bypass the handlers above (e.g. an explicit
// process.exit elsewhere). killChildren() is synchronous, so it works here.
process.on('exit', () => killChildren())

app.listen(config.port, () =>
{
  console.log(`[backend] http://localhost:${config.port}`)
  console.log(`[backend] COLMAP: ${config.colmapBin}`)
  console.log(`[backend] Brush:  ${config.brushBin}`)
  console.log(`[backend] jobs:   ${config.jobsDir}`)
})
