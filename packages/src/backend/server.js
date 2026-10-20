/*!************************************************************************
\file server.js
\author1 Gabriel Sebastian Putra
\author2 Xiong Yang
\author3 Ethan Ng
\par DP email1: gabrielsebastian.p@digipen.edu
\par DP email2: xiong.yang@digipen.edu
\par DP email3: n.ethanyongle@digipen.edu
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
- readCookie(req, name) / startSession(res, userId, remember)
Read a cookie from the request / log a user in by setting the HttpOnly
session cookie (the session itself is stored in db.js). With "Remember me"
the cookie lasts 7 days; without it the browser drops it on close.
- loadUser / requireUser (middleware)
loadUser sets req.user from the session cookie on every request;
requireUser answers 401 when nobody is logged in.
- canAccessJob(user, jobId) / requireJobAccess (middleware)
Role check: admins can access every job, users only jobs they created.
requireJobAccess guards the /jobs/:id routes and answers 404 for someone
else's job.
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
import { getHardwareInfo } from './metrics.js'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'
import
{
  SESSION_TTL_MS, SHORT_SESSION_TTL_MS, createSession, createUser, deleteSession,
  findSessionUser, findUserByEmail, getJobOwnerId,
  listOwnedJobIds, setJobOwner, verifyPassword,
}
from './db.js'
import
{ 
  IMAGE_EXT_RE, JOB_ID_RE, scanJob, 
  scanJobs
} 
from './scan.js'
import 
{ 
  cancelJob, canonicalYoutubeUrl, jobs,
  killChildren, makeJob, pickSampleFileName, restoreJob,
  runPipeline, runYoutubePipeline, sampleFileName,
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

// Work out who is calling (from the session cookie) before any route runs.
app.use(loadUser)

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

// --- Accounts and access ----------------------------------------------------
const SESSION_COOKIE = 'genesis_session'

/************************************************************************/
/*!
  \brief
    Reads one cookie from the request's Cookie header (Express doesn't
    parse cookies without the cookie-parser package).
  \param req
    The request from the user
  \param name
  string
    The cookie's name
  \return
    The cookie's value, or null if it isn't set
*/
/************************************************************************/
function readCookie(req, name)
{
  for (const part of (req.headers.cookie ?? '').split(';'))
  {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === name)
    {
      try
      {
        return decodeURIComponent(part.slice(eq + 1).trim())
      }
      catch
      {
        return null
      }
    }
  }
  return null
}

/************************************************************************/
/*!
  \brief
    Starts a session for a user and sends it to the browser as an
    HttpOnly cookie (page scripts can't read it). The browser then sends
    it with every request to this server, including <img> loads.
  \param res
    The response from the backend
  \param userId
  number
    The user's id
  \param remember
  bool
    true ("Remember me" ticked): the cookie lasts SESSION_TTL_MS (7 days).
    false: no maxAge, so it is a browser-session cookie that is dropped
    when the browser closes; the server also expires it after
    SHORT_SESSION_TTL_MS in case the browser stays open or restores it.
*/
/************************************************************************/
function startSession(res, userId, remember)
{
  const options = { httpOnly: true, sameSite: 'lax', path: '/' }
  if (remember) options.maxAge = SESSION_TTL_MS
  res.cookie(SESSION_COOKIE, createSession(userId, remember ? SESSION_TTL_MS : SHORT_SESSION_TTL_MS), options)
}

/************************************************************************/
/*!
  \brief
    Middleware: sets req.user to the logged-in user ({ id, email, name,
    role, created_at }) or null. Never rejects; requireUser does that.
  \param req
    The request from the user
  \param _res
    The response from the backend
  \param next
    moving on
*/
/************************************************************************/
function loadUser(req, _res, next)
{
  req.user = findSessionUser(readCookie(req, SESSION_COOKIE))
  next()
}

/************************************************************************/
/*!
  \brief
    Middleware: rejects the request unless someone is logged in.
  \return
    401 if not logged in
*/
/************************************************************************/
function requireUser(req, res, next)
{
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' })
  next()
}

/************************************************************************/
/*!
  \brief
    Whether a user may see / use a job: admins can access every job,
    other users only the jobs they created. A job with no recorded owner
    (made before accounts existed) is admin-only.
  \param user
    req.user
  \param jobId
  string
    The job's id
  \return
    bool
*/
/************************************************************************/
function canAccessJob(user, jobId)
{
  if (!user) return false
  if (user.role === 'admin') return true
  return getJobOwnerId(jobId) === user.id
}

/************************************************************************/
/*!
  \brief
    Middleware for /jobs/:id routes: login required, and the job must be
    accessible to the caller. Someone else's job answers 404, not 403, so
    it can't be used to find out which job ids exist.
  \return
    401 if not logged in, 404 if the job isn't theirs
*/
/************************************************************************/
function requireJobAccess(req, res, next)
{
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' })
  if (!canAccessJob(req.user, req.params.id)) return res.status(404).json({ error: 'job not found' })
  next()
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
const storage = multer.diskStorage({
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
const upload = multer({
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
        return res.status(400).json({
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

/************************************************************************/
/*!
  \brief
    Middleware for the authority-only account API (/register,
    /verify-account). Rejects any request without the shared secret in the
    X-Auth-Key header. Only meaningful when this instance is the authority.
  \return
    503 if this instance isn't the authority, 401 on a missing/wrong key
*/
/************************************************************************/
/*
function requireAuthorityKey(req, res, next)
{
  if (config.authMode !== 'authority')
    return res.status(503).json({ error: 'This server is not the account authority.' })
  const key = req.get('X-Auth-Key')
  // constant-time compare so the key can't be guessed by timing
  const expected = config.authApiKey
  if (!expected || !key ||
      key.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected)))
    return res.status(401).json({ error: 'Unauthorized.' })
  next()
}
*/

/************************************************************************/
/*!
  \brief
    Call the account authority (VM). Adds the shared API key and parses the
    JSON reply. Throws on a network failure so the route can answer 503.
  \param endpoint  '/register' or '/verify-account'
  \param body      the JSON payload
  \return          { status, data }
*/
/************************************************************************/
/*
async function callAuthority(endpoint, body)
{
  const resp = await fetch(`${config.vmAuthUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Key': config.authApiKey },
    body: JSON.stringify(body),
  })
  const data = await resp.json().catch(() => ({}))
  return { status: resp.status, data }
}
*/

// ----- End of Functions ----------------------------------------------------- //

// ----- Start of Routes ------------------------------------------------------ // 

/************************************************************************/
/*!
  \brief
    Create a reconstruction job from uploaded photos. Returns a job id 
    immediately and runs COLMAP + Brush in the background -- the frontend 
    polls for status. The job is owned by the logged-in user. requireUser
    runs before assignJobId so a logged-out request never creates a folder.
  \return
    401 if not logged in, 400 if less than 8 photos given, 202 if successful
*/
/************************************************************************/
app.post('/upload', requireUser, assignJobId, upload.array('images', config.maxFiles), onlyImages, (req, res) =>
{
  const files = req.files || []
  if (files.length < 8)
  {
    // Reject cleanly: remove the job folder assignJobId created up front so a
    // too-small batch doesn't leave an orphan folder behind (same as onlyImages).
    fs.rmSync(path.join(config.jobsDir, req.jobId), { recursive: true, force: true })
    return res.status(400).json({
      error: `Need at least 8 photos (got ${files.length}). More overlapping photos = better reconstruction.`,
    })
  }
  setJobOwner(req.jobId, req.user.id)
  const job = makeJob(req.jobId)
  job.imageCount = files.length
  job.source = 'upload'
  // Optional multipart text field: mask out the background before COLMAP
  // (needed for turntable captures, see generateMasks in pipeline.js).
  job.removeBackground = ['true', '1', 'on'].includes(String(req.body?.removeBackground).toLowerCase())
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
    from "interrupted". Admins get every job; other users only the jobs
    they created.
  \return
    401 if not logged in, else a record of every visible job's details
*/
/************************************************************************/
app.get('/jobs', requireUser, async (req, res) =>
{
  let records = await scanJobs(config.jobsDir)
  if (req.user.role !== 'admin')
  {
    const owned = listOwnedJobIds(req.user.id)
    records = records.filter((record) => owned.has(record.id))
  }
  res.json(
    records.map((record) =>
    {
      const job = jobs.get(record.id) ?? restoreJob(record);
      return {
        id: record.id,
        name: job.name ?? null,
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
    folder. Only the job's owner or an admin can load it.
  \return
    401 if not logged in, 404 if image doesn't exist or isn't theirs, else
    the image itself
*/
/************************************************************************/
app.get('/jobs/:id/images/:name', requireJobAccess, (req, res) =>
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
    number, maxFrames?: number }. The job is owned by the logged-in user.
  \return
    401 if not logged in, 400 if url doesn't work, else 202 and starts a
    job and runs youtube pipeline
*/
/************************************************************************/
app.post('/jobs/from-youtube', requireUser, (req, res) =>
{
  const { url, fps, maxFrames } = req.body || {}
  // Only single YouTube videos; the canonical form drops any playlist params.
  const videoUrl = canonicalYoutubeUrl(url)
  if (!videoUrl) 
  {
    return res.status(400).json({
      error: 'Please use a link to a single YouTube video (youtube.com/watch?v=…, youtu.be/…, or youtube.com/shorts/…).',
    })
  }

  const jobId = crypto.randomUUID()
  fs.mkdirSync(path.join(config.jobsDir, jobId, 'images'), { recursive: true })
  setJobOwner(jobId, req.user.id)
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
    Poll a job's status (bounded log tail, not the full log). Owner or
    admin only.
  \return
    401 if not logged in, 404 if job not found or isn't theirs
    else status, phase, progress, error and the last 40 log lines
*/
/************************************************************************/
app.get('/jobs/:id', requireJobAccess, async (req, res) =>
{
  const job = await getJob(req.params.id)
  if (!job) 
    return res.status(404).json({ error: 'job not found' })
  res.json({
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    detail: job.detail,
    error: job.error,
    updatedAt: job.updatedAt ?? null,
    imageCount: job.imageCount ?? null,
    removeBackground: !!job.removeBackground,
    hasResult: job.status === 'done' && !!job.resultPath,
    logTail: job.log.slice(-40),
  })
})

/************************************************************************/
/*!
  \brief
    Cancel a running job: kills its COLMAP / Brush / python process so the 
    GPU is freed immediately. Idempotent; a finished job answers 409.
    Owner or admin only.
  \return
    401 if not logged in
    404 if job not found or isn't theirs
    409 if job is finished
    kills processes and frees GPU
*/
/************************************************************************/
app.delete('/jobs/:id', requireJobAccess, async (req, res) =>
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
    Download / stream the finished splat .ply. Owner or admin only.
  \return
    401 if not logged in, 404 if result is not ready or isn't theirs
*/
/************************************************************************/
app.get('/jobs/:id/result.ply', requireJobAccess, async (req, res) =>
{
  const job = await getJob(req.params.id)
  if (!job || job.status !== 'done' || !job.resultPath) 
  {
    return res.status(404).json({ error: 'result not ready' })
  }
  res.setHeader('Content-Type', 'application/octet-stream')
  res.sendFile(job.resultPath)
})

const MAX_JOB_NAME_LENGTH = 80

/************************************************************************/
/*!
  \brief
    Rename a job (the model and its photo batch share one name). Body:
    { name: string }. An empty name resets it to the default. The
    display name is saved in status.json, and the model's copy in the
    engine's samples folder is renamed to match (see pickSampleFileName).
    The job folders keep their id.
  \return
    404 if job not found, 400 if the name is too long, 409 if the sample
    file can't be renamed (e.g. open in another program), else the new
    name and sample filename
*/
/************************************************************************/
app.patch('/jobs/:id', async (req, res) =>
{
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })

  const { name } = req.body || {}
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed.length > MAX_JOB_NAME_LENGTH)
    return res.status(400).json({ error: `Name must be at most ${MAX_JOB_NAME_LENGTH} characters.` })

  const newName = trimmed || null
  const oldFile = sampleFileName(job)
  const newFile = pickSampleFileName(job, newName)
  if (newFile !== oldFile)
  {
    try
    {
      await fs.promises.rename(
        path.join(config.engineSamplesDir, oldFile),
        path.join(config.engineSamplesDir, newFile),
      )
    }
    catch (err)
    {
      // No copy yet (still processing, or trained before copies existed):
      // the new filename is still recorded, so the pipeline copies under it.
      if (err.code !== 'ENOENT')
        return res.status(409).json({ error: `Couldn't rename ${oldFile} in the engine samples folder (${err.code}). Close any program using it and try again.` })
    }
  }

  job.name = newName
  job.sampleFile = newFile
  saveJob(job)
  res.json({ id: job.id, name: job.name, sampleFile: newFile })
})

/************************************************************************/
/*!
  \brief
    Permanently delete a job: its photos, COLMAP files, splat output and
    the copy in the engine's samples folder. A job still processing is
    cancelled first so its tools stop writing into the folders.
  \return
    404 if job not found, else 200 once the folders are gone
*/
/************************************************************************/
app.delete('/jobs/:id/files', async (req, res, next) =>
{
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })

  cancelJob(job) // no-op for a finished job
  jobs.delete(job.id)

  try
  {
    // Retries cover Windows briefly locking files of a tool that was just killed.
    const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }
    await fs.promises.rm(path.join(config.jobsDir, job.id), rmOpts)
    await fs.promises.rm(path.join(config.jobsDir, `${job.id}_out`), rmOpts)
    await fs.promises.rm(path.join(config.engineSamplesDir, sampleFileName(job)), { force: true })
    res.json({ id: job.id, deleted: true })
  }
  catch (err)
  {
    next(err)
  }
})

const EMAIL_RE = /^\S+@\S+\.\S+$/

/************************************************************************/
/*!
  \brief
    Shapes a users row into what the frontend keeps as the session. Never
    includes password_hash.
  \param user
    { email, name, role, createdAt } or a users row
  \return
    { name, email, role, memberSince }
*/
/************************************************************************/
function publicUser(user)
{
  // SQLite datetime('now') is UTC without a zone marker.
  const created = new Date(`${(user.createdAt ?? user.created_at).replace(' ', 'T')}Z`)
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    memberSince: created.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' }),
  }
}

/************************************************************************/
/*!
  \brief
    Create an account and log it in. Body: { name, email, password,
    remember? }. The password is stored only as a salted scrypt hash (see
    db.js). New accounts are always role 'user'. remember: true keeps the
    login after the browser closes (see startSession).
  \return
    400 if input is invalid, 409 if the email is taken, else 201, the
    user, and a session cookie
*/
/************************************************************************/
app.post('/auth/signup', async (req, res, next) =>
{
  const { name, email, password, remember } = req.body || {}
  const trimmedEmail = typeof email === 'string' ? email.trim() : ''
  const trimmedName = typeof name === 'string' ? name.trim() : ''

  if (!EMAIL_RE.test(trimmedEmail))
    return res.status(400).json({ error: 'Enter a valid email address.' })
  if (typeof password !== 'string' || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' })
  if (!trimmedName)
    return res.status(400).json({ error: 'Enter your name.' })

  try
  {
    const user = await createUser({ email: trimmedEmail, name: trimmedName, password })
    startSession(res, user.id, remember === true)
    res.status(201).json(publicUser(user))
  }
  catch (err)
  {
    if (err.code === 'EMAIL_TAKEN')
      return res.status(409).json({ error: 'An account with that email already exists.' })
    next(err)
  }
})

/*
app.post('/auth/signup', async (req, res, next) =>
{
  const { name, email, password, remember } = req.body || {}

  // Authority (VM): behave exactly as before, using the local accounts DB.
  if (config.authMode === 'authority')
  {
    const trimmedEmail = typeof email === 'string' ? email.trim() : ''
    const trimmedName = typeof name === 'string' ? name.trim() : ''
    if (!EMAIL_RE.test(trimmedEmail))
      return res.status(400).json({ error: 'Enter a valid email address.' })
    if (typeof password !== 'string' || password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' })
    if (!trimmedName)
      return res.status(400).json({ error: 'Enter your name.' })
    try
    {
      const user = await createUser({ email: trimmedEmail, name: trimmedName, password })
      startSession(res, user.id, remember === true)
      return res.status(201).json(publicUser(user))
    }
    catch (err)
    {
      if (err.code === 'EMAIL_TAKEN')
        return res.status(409).json({ error: 'An account with that email already exists.' })
      return next(err)
    }
  }

  // Client: forward to the VM, mirror the returned user, then start a local session.
  try
  {
    const { status, data } = await callAuthority('/register', { name, email, password })
    if (status !== 201)
      return res.status(status).json({ error: data.error || 'Signup failed.' })
    upsertLocalUser(data)                 // mirror VM id -> local users
    startSession(res, data.id, remember === true)
    res.status(201).json(publicUser({ ...data, created_at: new Date().toISOString() }))
  }
  catch
  {
    res.status(503).json({ error: 'Account service is unavailable. Try again shortly.' })
  }
})
*/

/************************************************************************/
/*!
  \brief
    Sign in. Body: { email, password, remember? }. Unknown email and wrong
    password get the same answer so the endpoint can't be used to probe
    accounts. remember: true keeps the login after the browser closes.
  \return
    401 if the credentials don't match, else 200, the user, and a session
    cookie
*/
/************************************************************************/
app.post('/auth/login', async (req, res, next) =>
{
  const { email, password, remember } = req.body || {}
  if (typeof email !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'Enter your email and password.' })

  try
  {
    const user = findUserByEmail(email.trim())
    if (!user || !(await verifyPassword(password, user.password_hash)))
      return res.status(401).json({ error: 'Incorrect email or password.' })
    startSession(res, user.id, remember === true)
    res.json(publicUser(user))
  }
  catch (err)
  {
    next(err)
  }
})

/*
app.post('/auth/login', async (req, res, next) =>
{
  const { email, password, remember } = req.body || {}
  if (typeof email !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'Enter your email and password.' })

  // Authority (VM): unchanged local-DB behavior.
  if (config.authMode === 'authority')
  {
    try
    {
      const user = findUserByEmail(email.trim())
      if (!user || !(await verifyPassword(password, user.password_hash)))
        return res.status(401).json({ error: 'Incorrect email or password.' })
      startSession(res, user.id, remember === true)
      return res.json(publicUser(user))
    }
    catch (err) { return next(err) }
  }

  // Client: verify against the VM, mirror the user, start a local session.
  try
  {
    const { status, data } = await callAuthority('/verify-account', { email, password })
    if (status !== 200 || !data.valid)
      return res.status(401).json({ error: 'Incorrect email or password.' })
    upsertLocalUser(data)
    startSession(res, data.id, remember === true)
    res.json(publicUser({ ...data, created_at: new Date().toISOString() }))
  }
  catch
  {
    res.status(503).json({ error: 'Account service is unavailable. Try again shortly.' })
  }
})
*/

/************************************************************************/
/*!
  \brief
    Who is logged in, according to the session cookie. Lets the frontend
    check a saved session is still valid (and pick up role changes).
  \return
    401 if not logged in, else the user
*/
/************************************************************************/
app.get('/auth/me', requireUser, (req, res) =>
{
  res.json(publicUser(req.user))
})

/************************************************************************/
/*!
  \brief
    Log out: deletes the session and clears the cookie. Safe to call when
    already logged out.
  \return
    204
*/
/************************************************************************/
app.post('/auth/logout', (req, res) =>
{
  deleteSession(readCookie(req, SESSION_COOKIE))
  res.clearCookie(SESSION_COOKIE, { path: '/' })
  res.status(204).end()
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

/************************************************************************/
/*!
  \brief
    Authority-only: create an account in the VM's database. Called by a
    client backend's /auth/signup, not by browsers. Returns the new user's
    canonical id so clients can own jobs by it.
  \return
    400 invalid input, 409 email taken, 201 { id, email, name, role }
*/
/************************************************************************/
/*
app.post('/register', requireAuthorityKey, async (req, res, next) =>
{
  const { name, email, password } = req.body || {}
  const trimmedEmail = typeof email === 'string' ? email.trim() : ''
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (!EMAIL_RE.test(trimmedEmail))
    return res.status(400).json({ error: 'Enter a valid email address.' })
  if (typeof password !== 'string' || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' })
  if (!trimmedName)
    return res.status(400).json({ error: 'Enter your name.' })
  try
  {
    const user = await createUser({ email: trimmedEmail, name: trimmedName, password })
    res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role })
  }
  catch (err)
  {
    if (err.code === 'EMAIL_TAKEN')
      return res.status(409).json({ error: 'An account with that email already exists.' })
    next(err)
  }
})
*/

/************************************************************************/
/*!
  \brief
    Authority-only: check credentials against the VM's database. Unknown
    email and wrong password return the same { valid: false } so the
    endpoint can't be used to probe which emails are registered.
  \return
    200 { valid: true, id, email, name, role } or { valid: false }
*/
/************************************************************************/
/*
app.post('/verify-account', requireAuthorityKey, async (req, res, next) =>
{
  const { email, password } = req.body || {}
  if (typeof email !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'Email and password required.' })
  try
  {
    const user = findUserByEmail(email.trim())
    if (!user || !(await verifyPassword(password, user.password_hash)))
      return res.json({ valid: false })
    res.json({ valid: true, id: user.id, email: user.email, name: user.name, role: user.role })
  }
  catch (err)
  {
    next(err)
  }
})
*/

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
  console.log(`[backend] Python: ${config.pythonBin}`)
  console.log(`[backend] jobs:   ${config.jobsDir}`)
  // Probe hardware now (cached) so recording a job's metrics doesn't wait on it.
  getHardwareInfo().then((hw) =>
    console.log(`[backend] GPU:    ${hw.gpus?.map((g) => g.name).join(', ') || 'none detected'}`))
})
