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
- requireAuthorityKey / callAuthority / clientAuthProblem /
  logAuthorityFailure
Centralized accounts (config.authMode). On the VM ('authority'),
requireAuthorityKey guards /register and /verify-account with the shared
key. On other machines ('client'), callAuthority forwards signup/login to
the VM (8 s timeout), clientAuthProblem refuses to run without a key or
over plain http://, and logAuthorityFailure names setup mistakes in the
log. 'local' keeps accounts on this machine.
- validateSignup(body) / checkCredentials(email, password)
Shared signup rules, and the password check with a per-email limit of 10
wrong passwords per 15 minutes.
- limitByIp(limiter) / tooManyAttempts(retryAfterSec)
Per-IP request limits for /auth/login and /auth/signup (429 when passed).
- isRemoteJob(id) / actAsUser (middleware)
Shared library. On a client machine, a job id with no folder here is in the
VM's library, so the /jobs routes pass the request to the VM (library.js).
On the VM, the same routes also answer under /library/... for client
machines (shared key required), acting as the user they name -- with the
role from the VM's own database.
- requireFreeDisk / prepareStore / storeUpload / PUT /library/jobs/:id
On the VM: receive a finished job from a client machine (photos, result.ply,
metrics.json), check it, and store it in jobs/ like a VM-made job.
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
- videoUpload(multer instance) / onlyMp4(req, res, next)
The video extractor's .mp4 upload (POST /jobs/from-video): one file, saved
as the hidden jobs/.video-<id>.mp4, then its real type checked like
onlyImages. The video is deleted as soon as its frames are extracted
(runVideoFilePipeline), so only the frames are kept.
- ensureCover(jobId)
Makes the job's card cover (<id>_out/cover.webp) with tools/make_cover.py
the first time it is asked for: the object cut out of a photo with the
job's background masks. Concurrent requests share one run.
- afterJobEnds(job)
Runs once a job is done, failed or cancelled: makes the cover while the
photos and masks exist, tidies up working files (pruneJob), sends the job
to the VM (client machines) and, on the VM with FILE_STORE=db, moves its
photos into the database (imagestore.js). Photos then come from the
database in GET /jobs/:id/images/:name.
- shutdown(reason, exitCode)
Runs only once. Marks every running job as error and saves it, calls 
killChildren() to stop the COLMAP/Brush/python processes, then exits.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import multer from 'multer'
import express from 'express'
import crypto from 'node:crypto'
import { config } from './config.js'
import { STATUS_FILE, STATUS_VERSION, saveJob } from './status.js'
import { getHardwareInfo } from './metrics.js'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'
import
{
  SESSION_TTL_MS, SHORT_SESSION_TTL_MS, createSession, createUser, deleteDbImages,
  deleteSession, findOrCreateGoogleUser, findSessionUser, findUserByEmail,
  findUserById, getDbImage, getJobOwnerId, isJobSynced, listDbImageNames,
  listOwnedJobIds, recordStoredJob, retireLocalAccounts, setJobOwner,
  storeJobImages, unmarkJobSynced, upsertLocalUser, verifyPassword,
}
    from './db.js'
import { migrateImagesToDb, moveImagesToDb } from './imagestore.js'
import { createLimiter } from './ratelimit.js'
import
{
  fetchRemoteJobs, forwardToVm, proxyToVm, startLibrarySync, syncPendingJobs,
}
from './library.js'
import
{ 
  IMAGE_EXT_RE, JOB_ID_RE, scanJob,
  scanJobs, setImageNameSource,
}
from './scan.js'
import 
{ 
  cancelJob, canonicalYoutubeUrl, jobs,
  killChildren, makeJob, pickSampleFileName, pruneJob, restoreJob,
  runPipeline, runVideoFilePipeline, runYoutubePipeline, sampleFileName,
}
    from './pipeline.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

fs.mkdirSync(config.jobsDir, { recursive: true })

// Photos in the database (FILE_STORE=db) is for the VM only: client machines
// build models from photos on disk and send them to the VM.
const imagesInDb = config.fileStore === 'db' && config.authMode === 'authority'
if (config.fileStore === 'db' && !imagesInDb)
  console.warn('[backend] FILE_STORE=db is ignored: it only applies with AUTH_MODE=authority (the VM).')
if (imagesInDb)
{
  // Jobs whose images/ folder has moved into the database are still listed,
  // and any photos still on disk (first start, or after a crash) move in now.
  setImageNameSource(listDbImageNames)
  await migrateImagesToDb()
}

// Jobs live in memory, so rebuild them from the job folders on disk. Without
// this, everything finished before a restart 404s on /jobs/:id and result.ply.
const restored = await scanJobs(config.jobsDir)

// Folder where the wiki repo was cloned
// os.homedir() rather than $HOME: Windows doesn't set HOME.
const WIKI_DIR = path.join(os.homedir(), 'wiki')

for (const record of restored) {
    if (!jobs.has(record.id)) {
        restoreJob(record)
    }
}

console.log(`[backend] restored ${restored.length} job(s) from ${config.jobsDir}`)

// Staging folders left by shared-library uploads cut off mid-way (crash or
// restart during a PUT /library/jobs/:id). Their jobs are re-sent later.
// Also uploaded videos whose frame extraction was cut off the same way:
// videos are never kept (see POST /jobs/from-video).
for (const entry of fs.readdirSync(config.jobsDir))
{
  if (entry.startsWith('.incoming-') || entry.startsWith('.video-'))
    fs.rmSync(path.join(config.jobsDir, entry), { recursive: true, force: true })
}

// A machine that sends accounts to the VM can't keep its own: their ids and
// emails would clash with the VM's. Only the first client-mode start finds any.
if (config.authMode === 'client') {
    const { removed, backupPath } = retireLocalAccounts()
    if (removed > 0) {
        console.log(`[backend] client mode: removed ${removed} local account(s); their uploads are now admin-only.`)
        console.log(`[backend] database backup before that: ${backupPath}`)
    }
}

const app = express()

// Behind a reverse proxy (Caddy on the VM) req.ip / req.secure would describe
// the proxy, not the browser. TRUST_PROXY tells Express which hop to believe.
if (config.trustProxy) {
    const value = config.trustProxy
    app.set('trust proxy', value === 'true' ? true : /^\d+$/.test(value) ? Number(value) : value)
}

// Parse JSON bodies (used by /jobs/from-youtube). Only applies to
// application/json requests, so the multipart photo and video uploads are unaffected.
app.use(express.json())

// Serve the built React frontend (run `npm run build` to produce web-app/dist).
app.use(express.static(path.join(__dirname, '../web-app/dist')))

// Work out who is calling (from the session cookie) before any route runs.
app.use(loadUser)

// Shared library (VM only): client machines reach the same job routes under
// /library/..., with the shared key instead of a cookie, acting as the user
// they name. 503 on any machine that isn't the account authority.
app.use('/library', requireAuthorityKey, actAsUser)

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
async function getJob(id) {
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
function readCookie(req, name) {
    for (const part of (req.headers.cookie ?? '').split(';')) {
        const eq = part.indexOf('=')
        if (eq !== -1 && part.slice(0, eq).trim() === name) {
            try {
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
function startSession(res, userId, remember) {
    // secure: over HTTPS (e.g. behind Caddy) the browser never sends the
    // cookie over plain HTTP. Stays off for http://localhost development.
    const options = { httpOnly: true, sameSite: 'lax', path: '/', secure: res.req.secure }
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
function loadUser(req, _res, next) {
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
function requireUser(req, res, next) {
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
function canAccessJob(user, jobId) {
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
  // On a client machine, a job that isn't here may be in the VM's shared
  // library: the route passes the request on, and the VM applies the same
  // owner / admin rule (see isRemoteJob).
  if (isRemoteJob(req.params.id))
  {
    req.remoteJob = true
    return next()
  }
  if (!canAccessJob(req.user, req.params.id)) return res.status(404).json({ error: 'job not found' })
  next()
}

/************************************************************************/
/*!
  \brief
    On a client machine with a working VM connection: true when a job id
    has no folder here, so the job can only be in the VM's shared library.
    Always false on the VM and in local mode.
  \param id
  string
    The job id from the URL
  \return
    bool
*/
/************************************************************************/
function isRemoteJob(id)
{
  return config.authMode === 'client' && !clientAuthProblem() &&
    JOB_ID_RE.test(id) && !fs.existsSync(path.join(config.jobsDir, id))
}

/************************************************************************/
/*!
  \brief
    Middleware for the VM's /library routes (after requireAuthorityKey):
    sets req.user to the user named in the X-Act-As-User header, looked up
    in the VM's own database -- so the role comes from the VM, never from
    the client machine. No header (e.g. storing a job) means no user.
  \param req
    The request from the client machine
  \param _res
    The response
  \param next
    moving on
*/
/************************************************************************/
function actAsUser(req, _res, next)
{
  const raw = req.get('X-Act-As-User')
  const id = Number(raw)
  req.user = raw && Number.isInteger(id) ? findUserById(id) : null
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
function assignJobId(req, _res, next) {
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

    filename: (req, file, cb) => {
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
async function onlyImages(req, res, next) {
    const files = req.files || []
    if (files.length === 0) return next()

    try {
        const { fileTypeFromFile } = await import('file-type')
        const legalMimes = ['image/jpeg', 'image/png']

        for (const file of files) {
            const type = await fileTypeFromFile(file.path)

            if (!type || !legalMimes.includes(type.mime)) {
                // Reject the batch: remove the job folder created up front by assignJobId.
                await fs.promises.rm(path.join(config.jobsDir, req.jobId), { recursive: true, force: true })
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

/************************************************************************/
/*!
  \brief
    The video extractor's .mp4 upload: one file, saved as the hidden
    jobs/.video-<jobId>.mp4 (scanJobs ignores dot-names, and startup
    deletes any left by a crash). req.videoPath is set so it is deleted
    on every path: by runVideoFilePipeline once the frames are extracted,
    or by onlyMp4 / the error handler if the upload is refused. The
    declared type is only a first filter; onlyMp4 checks the bytes.
  \return
    nothing
*/
/************************************************************************/
const videoUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, config.jobsDir),
        filename: (req, _file, cb) => {
            const name = `.video-${req.jobId}.mp4`
            req.videoPath = path.join(config.jobsDir, name)
            cb(null, name)
        },
    }),
    limits: { fileSize: config.maxVideoSizeMB * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) =>
        cb(null, file.mimetype === 'video/mp4' || path.extname(file.originalname).toLowerCase() === '.mp4'),
})

/************************************************************************/
/*!
  \brief
    Content-level guard for the video upload, like onlyImages: the file's
    actual bytes must be an MP4. Otherwise the video and the job folder
    are deleted.
  \param req
    The request from the user
  \param res
    The response from the backend
  \param next
    moving on
  \return
    400 if no video was sent or it isn't a real MP4
*/
/************************************************************************/
async function onlyMp4(req, res, next) {
    const reject = async (error) => {
        await fs.promises.rm(path.join(config.jobsDir, req.jobId), { recursive: true, force: true })
        if (req.videoPath) await fs.promises.rm(req.videoPath, { force: true })
        res.status(400).json({ error })
    }
    try {
        if (!req.file) return await reject('Please choose an .mp4 video file.')
        const { fileTypeFromFile } = await import('file-type')
        const type = await fileTypeFromFile(req.file.path)
        if (type?.ext !== 'mp4') return await reject('Invalid file content -- only real .mp4 videos are accepted.')
        next()
    } catch (err) {
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
function shutdown(reason, exitCode = 0) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[backend] ${reason} -- stopping running tool processes`)
    for (const job of jobs.values()) {
        if (job.status === 'running') {
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

function requireAuthorityKey(req, res, next) {
    if (config.authMode !== 'authority')
        return res.status(503).json({ error: 'This server is not the account authority.' })
    const key = Buffer.from(req.get('X-Auth-Key') ?? '')
    // constant-time compare so the key can't be guessed by timing. Byte
    // lengths must match first or timingSafeEqual throws.
    const expected = Buffer.from(config.authApiKey)
    if (expected.length === 0 || key.length !== expected.length ||
        !crypto.timingSafeEqual(key, expected))
        return res.status(401).json({ error: 'Unauthorized.' })
    next()
}


/************************************************************************/
/*!
  \brief
    Call the account authority (VM). Adds the shared API key and parses the
    JSON reply. Gives up after 8 seconds so a VM that is down can't leave
    the Sign in button spinning. Throws on a network failure or timeout so
    the route can answer 503.
  \param endpoint  '/register' or '/verify-account'
  \param body      the JSON payload
  \return          { status, data }
*/
/************************************************************************/
async function callAuthority(endpoint, body) {
    const resp = await fetch(`${config.vmAuthUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Key': config.authApiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
    })
    const data = await resp.json().catch(() => ({}))
    return { status: resp.status, data }
}

/************************************************************************/
/*!
  \brief
    In client mode, why this machine can't talk to the VM safely, or null
    if it can. Checked before every call, and logged once at startup.
  \return
    string describing the problem, or null
*/
/************************************************************************/
function clientAuthProblem() {
    if (!config.authApiKey)
        return 'AUTH_API_KEY is not set (see packages/src/backend/.env.example).'
    let url
    try {
        url = new URL(config.vmAuthUrl)
    }
    catch
    {
        return `VM_AUTH_URL "${config.vmAuthUrl}" is not a valid URL.`
    }
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !isLocal && !config.allowInsecureAuth)
        return `VM_AUTH_URL must be https:// (passwords are sent to it). ` +
            `Set AUTH_ALLOW_HTTP=1 only for temporary testing.`
    return null
}

/************************************************************************/
/*!
  \brief
    Turns an unexpected reply from the VM into a log line naming the likely
    cause, so a setup mistake doesn't look like a wrong password.
  \param endpoint
    '/register' or '/verify-account'
  \param status
    The VM's HTTP status
  \param data
    The VM's JSON reply
*/
/************************************************************************/
function logAuthorityFailure(endpoint, status, data) {
    const cause =
        status === 401 ? 'the VM rejected this machine\'s AUTH_API_KEY (keys must match exactly)' :
            status === 503 ? 'the VM is not running with AUTH_MODE=authority' :
                `unexpected reply ${status}: ${JSON.stringify(data)}`
    console.error(`[backend] account authority ${endpoint} failed -- ${cause}`)
}

// --- Rate limits -------------------------------------------------------------
// Slow down password guessing and signup spam. Per-IP limits run on every
// machine; the per-email failure limit runs where passwords are checked
// (authority or local), so attempts relayed through client machines count too.
const loginIpLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 30 })
const signupIpLimiter = createLimiter({ windowMs: 60 * 60 * 1000, max: 10 })
const failedLoginLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 10 })

/************************************************************************/
/*!
  \brief
    The message for a rate-limited request.
  \param retryAfterSec
  number
    Seconds until the limit lifts
  \return
    string
*/
/************************************************************************/
function tooManyAttempts(retryAfterSec) {
    const minutes = Math.max(1, Math.ceil(retryAfterSec / 60))
    return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
}

/************************************************************************/
/*!
  \brief
    Middleware factory: counts each request against the caller's IP and
    answers 429 once the limiter's maximum is passed.
  \param limiter
    A limiter from createLimiter
  \return
    Express middleware
*/
/************************************************************************/
function limitByIp(limiter) {
    return (req, res, next) => {
        const { allowed, retryAfterSec } = limiter.hit(req.ip)
        if (allowed) return next()
        res.set('Retry-After', String(retryAfterSec))
        res.status(429).json({ error: tooManyAttempts(retryAfterSec) })
    }
}

/************************************************************************/
/*!
  \brief
    Checks a signup body. Shared by /auth/signup (authority / local) and
    the VM's /register so the rules stay identical.
  \param body
    { name, email, password }
  \return
    { error } if invalid, else { name, email, password } with name and
    email trimmed
*/
/************************************************************************/
function validateSignup(body) {
    const { name, email, password } = body || {}
    const trimmedEmail = typeof email === 'string' ? email.trim() : ''
    const trimmedName = typeof name === 'string' ? name.trim() : ''
    if (!EMAIL_RE.test(trimmedEmail)) return { error: 'Enter a valid email address.' }
    if (typeof password !== 'string' || password.length < 6)
        return { error: 'Password must be at least 6 characters.' }
    if (!trimmedName) return { error: 'Enter your name.' }
    return { name: trimmedName, email: trimmedEmail, password }
}

/************************************************************************/
/*!
  \brief
    Checks an email + password against this machine's accounts, with the
    per-email failure limit: after 10 wrong passwords in 15 minutes that
    email is locked until the window ends, even with the right password.
    A correct password clears the count. Shared by /auth/login (authority /
    local) and the VM's /verify-account.
  \param email
  string
  \param password
  string
  \return
    { status: 'ok', user } | { status: 'invalid' } |
    { status: 'locked', retryAfterSec }
*/
/************************************************************************/
async function checkCredentials(email, password) {
    const key = email.trim().toLowerCase()
    const lock = failedLoginLimiter.check(key)
    if (!lock.allowed) return { status: 'locked', retryAfterSec: lock.retryAfterSec }

    const user = findUserByEmail(email.trim())
    if (!user || !(await verifyPassword(password, user.password_hash))) {
        failedLoginLimiter.hit(key)
        return { status: 'invalid' }
    }
    failedLoginLimiter.reset(key)
    return { status: 'ok', user }
}

/************************************************************************/
/*!
  \brief
    Read the optional training iteration cap the site sends with a new job
    (Fast / Normal / Detailed). Rounded to a whole number and clamped to
    config.minTrainIters..config.maxTrainIters.
  \param value
    The raw field value: a string from a multipart form, or a number from
    JSON.
  \return
    The iteration cap, or null (missing or not a positive number) to use
    config.trainIters.
*/
/************************************************************************/
function parseTrainIters(value) {
    const iters = Math.round(Number(value))
    if (!Number.isFinite(iters) || iters <= 0) return null
    return Math.min(Math.max(iters, config.minTrainIters), config.maxTrainIters)
}

// --- Google sign-in state ----------------------------------------------------
// The OAuth "state" is kept in a short-lived cookie in the browser that
// started the sign-in, so a callback link made in another browser (e.g. an
// attacker's, to log a victim into the attacker's account) is rejected.
// path '/auth/google' also covers '/auth/google/callback'.
const GOOGLE_STATE_COOKIE = 'genesis_google_state'
const GOOGLE_STATE_PATH = '/auth/google'

/************************************************************************/
/*!
  \brief
    Constant-time string comparison, so the state can't be guessed by
    timing. Byte lengths are checked first because timingSafeEqual throws
    on unequal lengths.
  \param a
  string
  \param b
  string
  \return
    true if both are non-empty and equal
*/
/************************************************************************/
function safeEqual(a, b) {
    const x = Buffer.from(String(a ?? ''))
    const y = Buffer.from(String(b ?? ''))
    return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y)
}
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
app.post('/upload', requireUser, assignJobId, upload.array('images', config.maxFiles), onlyImages, (req, res) => {
    const files = req.files || []
    if (files.length < 8) {
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
    // Optional multipart text field: training iteration cap (Fast / Normal / Detailed).
    job.trainIters = parseTrainIters(req.body?.trainIters)
    saveJob(job) // gives upload-only jobs a status record from the start
    // fire-and-forget; do not await. Settles once the job is done, failed
    // or cancelled (never rejects), then its files are tidied up.
    runPipeline(job).finally(() => afterJobEnds(job))
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
    they created. On a client machine the user's jobs in the VM's shared
    library are added (a local copy wins; if the VM can't be reached, only
    local jobs are listed). Also served on the VM as /library/jobs.
  \return
    401 if not logged in, else a record of every visible job's details
*/
/************************************************************************/
app.get(['/jobs', '/library/jobs'], requireUser, async (req, res) =>
{
  let records = await scanJobs(config.jobsDir)
  if (req.user.role !== 'admin')
  {
    const owned = listOwnedJobIds(req.user.id)
    records = records.filter((record) => owned.has(record.id))
  }
  const list = records.map((record) =>
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
      // Cut-out cover for the cards: already made, or can still be made
      // from the job's background masks (see ensureCover).
      cover: fs.existsSync(path.join(config.jobsDir, `${record.id}_out`, 'cover.webp')) ||
        fs.existsSync(path.join(config.jobsDir, record.id, 'masks'))
        ? `/jobs/${record.id}/cover.webp`
        : null,
      images: record.images,
    }
  })

  if (config.authMode === 'client' && !clientAuthProblem())
  {
    const remote = await fetchRemoteJobs(req.user)
    if (remote)
    {
      const localIds = new Set(list.map((job) => job.id))
      list.push(...remote.filter((job) => !localIds.has(job.id)))
      list.sort((a, b) => b.createdAt - a.createdAt)
    }
  }
  res.json(list)
})

/************************************************************************/
/*!
  \brief
    Serve a single uploaded image. id/name are whitelisted to plain filename
    characters so a request can't use `..` or slashes to escape the jobs
    folder. Only the job's owner or an admin can load it. A job only in
    the VM's shared library is fetched from there. On the VM with
    FILE_STORE=db, a photo no longer on disk is served from the database.
  \return
    401 if not logged in, 404 if image doesn't exist or isn't theirs, else
    the image itself
*/
/************************************************************************/
app.get(['/jobs/:id/images/:name', '/library/jobs/:id/images/:name'], requireJobAccess, (req, res) =>
{
  if (req.remoteJob) return proxyToVm(req, res, `/library${req.path}`)
  const { id, name } = req.params
  if (!JOB_ID_RE.test(id) || !/^[\w.-]+$/.test(name) || !IMAGE_EXT_RE.test(name))
  {
    return res.status(404).json({ error: 'image not found' })
  }
  const filePath = path.join(config.jobsDir, id, 'images', name)
  if (!fs.existsSync(filePath) && imagesInDb)
  {
    const image = getDbImage(id, name)
    if (!image) return res.status(404).json({ error: 'image not found' })
    res.type(image.mime)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    return res.send(image.data)
  }
  res.sendFile(filePath, (err) =>
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
    number, maxFrames?: number, trainIters?: number }. The job is owned by the logged-in user.
  \return
    401 if not logged in, 400 if url doesn't work, else 202 and starts a
    job and runs youtube pipeline
*/
/************************************************************************/
app.post('/jobs/from-youtube', requireUser, (req, res) => {
    const { url, fps, maxFrames, trainIters } = req.body || {}
    // Only single YouTube videos; the canonical form drops any playlist params.
    const videoUrl = canonicalYoutubeUrl(url)
    if (!videoUrl) {
        return res.status(400).json({
            error: 'Please use a link to a single YouTube video (youtube.com/watch?v=…, youtu.be/…, or youtube.com/shorts/…).',
        })
    }

    const jobId = crypto.randomUUID()
    fs.mkdirSync(path.join(config.jobsDir, jobId, 'images'), { recursive: true })
    setJobOwner(jobId, req.user.id)
    const job = makeJob(jobId)
    job.source = 'youtube'
    job.trainIters = parseTrainIters(trainIters)
    saveJob(job)

    // fire-and-forget; the frontend polls /jobs/:id. Tidied up once it ends.
    runYoutubePipeline(job, videoUrl, frameOptions(fps, maxFrames)).finally(() => afterJobEnds(job))
    res.status(202).json({ id: job.id })
})

/************************************************************************/
/*!
  \brief
    Create a reconstruction job from an uploaded .mp4 (multipart field
    "video", plus optional fps, maxFrames and trainIters fields). Frames
    are extracted exactly as for a YouTube link, then the same COLMAP +
    Brush pipeline runs. The video itself is never kept: it is deleted as
    soon as extraction ends, whether it worked or not. The job is owned by
    the logged-in user.
  \return
    401 if not logged in, 400 if no real .mp4 was sent, 413 if it is over
    config.maxVideoSizeMB, else 202 and starts the job
*/
/************************************************************************/
app.post('/jobs/from-video', requireUser, assignJobId, videoUpload.single('video'), onlyMp4, (req, res) => {
    const { fps, maxFrames, trainIters } = req.body || {}
    setJobOwner(req.jobId, req.user.id)
    const job = makeJob(req.jobId)
    job.source = 'video'
    job.trainIters = parseTrainIters(trainIters)
    saveJob(job)

    // fire-and-forget; the frontend polls /jobs/:id. Tidied up once it ends.
    runVideoFilePipeline(job, req.videoPath, frameOptions(fps, maxFrames)).finally(() => afterJobEnds(job))
    res.status(202).json({ id: job.id })
})

/************************************************************************/
/*!
  \brief
    The frame-extraction options sent with a video job, within the
    server's limits.
  \param fps
    Requested frames per second (any type; ignored unless a positive number)
  \param maxFrames
    Requested frame cap (any type; ignored unless a positive number)
  \return
    { fps?, maxFrames? } for runYoutubePipeline / runVideoFilePipeline
*/
/************************************************************************/
function frameOptions(fps, maxFrames) {
    const opts = {}
    if (Number.isFinite(Number(fps)) && Number(fps) > 0) {
        opts.fps = Math.min(Number(fps), config.ytMaxFps)
    }
    if (Number.isFinite(Number(maxFrames)) && Number(maxFrames) > 0) {
        opts.maxFrames = Math.min(Number(maxFrames), config.maxFiles)
    }
    return opts
}

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
app.get(['/jobs/:id', '/library/jobs/:id'], requireJobAccess, async (req, res) =>
{
  if (req.remoteJob) return proxyToVm(req, res, `/library${req.path}`)
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
app.delete(['/jobs/:id', '/library/jobs/:id'], requireJobAccess, async (req, res) =>
{
  if (req.remoteJob) return proxyToVm(req, res, `/library${req.path}`)
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
app.get(['/jobs/:id/result.ply', '/library/jobs/:id/result.ply'], requireJobAccess, async (req, res) =>
{
  if (req.remoteJob) return proxyToVm(req, res, `/library${req.path}`)
  const job = await getJob(req.params.id)
  if (!job || job.status !== 'done' || !job.resultPath) 
  {
    return res.status(404).json({ error: 'result not ready' })
  }
  res.setHeader('Content-Type', 'application/octet-stream')
  res.sendFile(job.resultPath)
})

const execFileAsync = promisify(execFile)
// Covers being made right now, by job id, so cards asking at the same
// time share one run of make_cover.py.
const coversInProgress = new Map()
// Jobs whose cover couldn't be made, so it isn't retried on every visit
// (until the next restart).
const coversFailed = new Set()

/************************************************************************/
/*!
  \brief
    Make a job's cover (the object cut out of a photo with its background
    mask) with tools/make_cover.py, unless it already exists. Kept in
    <id>_out/cover.webp, so deleting the job removes it.
  \return
    Promise of the cover's path; rejects if the job has no masks or the
    script fails
*/
/************************************************************************/
function ensureCover(jobId) {
    const coverPath = path.join(config.jobsDir, `${jobId}_out`, 'cover.webp')
    if (fs.existsSync(coverPath)) return Promise.resolve(coverPath)
    if (coversFailed.has(jobId)) return Promise.reject(new Error('cover failed earlier'))
    if (coversInProgress.has(jobId)) return coversInProgress.get(jobId)

    const jobDir = path.join(config.jobsDir, jobId)
    const making = (async () => {
        if (!fs.existsSync(path.join(jobDir, 'masks'))) throw new Error('job has no masks')
        await fs.promises.mkdir(path.dirname(coverPath), { recursive: true })
        await execFileAsync(
            config.pythonBin,
            [config.coverScript, path.join(jobDir, 'images'), path.join(jobDir, 'masks'), coverPath],
            { timeout: 60_000, windowsHide: true },
        )
        return coverPath
    })()
    making.catch(() => coversFailed.add(jobId)).finally(() => coversInProgress.delete(jobId))
    coversInProgress.set(jobId, making)
    return making
}

/************************************************************************/
/*!
  \brief
    Serve the job's cut-out cover for the Library and Model Viewer cards,
    making it on first request. Owner or admin only.
  \return
    401 if not logged in, 404 if the job isn't theirs, has no background
    masks or the cover couldn't be made (the cards then show the first
    photo), else the WebP image. A job only in the VM's shared library is
    fetched from there.
*/
/************************************************************************/
app.get(['/jobs/:id/cover.webp', '/library/jobs/:id/cover.webp'], requireJobAccess, async (req, res) => {
    if (req.remoteJob) return proxyToVm(req, res, `/library${req.path}`)
    try {
        const coverPath = await ensureCover(req.params.id)
        res.setHeader('Cache-Control', 'private, max-age=86400')
        res.sendFile(coverPath)
    }
    catch (err) {
        console.warn(`[backend] no cover for ${req.params.id}: ${err.stderr?.trim() || err.message}`)
        res.status(404).json({ error: 'no cover' })
    }
})

/************************************************************************/
/*!
  \brief
    Tidies up a job once it has ended (done, failed or cancelled), in an
    order that keeps what each step needs:
      1. done + background masks: make the cover now, while the photos
         and masks still exist (ensureCover);
      2. done: delete COLMAP/Brush working files and the masks (pruneJob);
      3. done, client machine: send it to the VM's shared library;
      4. VM with FILE_STORE=db: move its photos into the database (also
         for failed / cancelled jobs, so their photos are kept).
    Never throws: each step logs its own problems.
  \param job
    The job whose pipeline just settled
  \return
    nothing
*/
/************************************************************************/
async function afterJobEnds(job) {
    try {
        if (job.status === 'done') {
            if (fs.existsSync(path.join(config.jobsDir, job.id, 'masks'))) {
                await ensureCover(job.id).catch((err) =>
                    console.warn(`[backend] no cover for ${job.id}: ${err.stderr?.trim() || err.message}`))
            }
            await pruneJob(job)
            if (config.authMode === 'client' && !clientAuthProblem()) syncPendingJobs()
        }
        if (imagesInDb) await moveImagesToDb(job.id)
    }
    catch (err) {
        console.error(`[backend] tidying up job ${job.id} failed:`, err)
    }
}

const MAX_JOB_NAME_LENGTH = 80

/************************************************************************/
/*!
  \brief
    Rename a job (the model and its photo batch share one name). Body:
    { name: string }. An empty name resets it to the default. The
    display name is saved in status.json, and the model's copy in the
    engine's samples folder is renamed to match (see pickSampleFileName).
    The job folders keep their id. Only the job's owner or an admin can
    rename it. On a client machine, a job only in the VM's shared library
    is renamed there; a local job already sent to the VM is renamed in
    both places.
  \return
    401 if not logged in, 404 if job not found or isn't theirs, 400 if the name is too long, 409 if the sample
    file can't be renamed (e.g. open in another program), else the new
    name and sample filename
*/
/************************************************************************/
app.patch(['/jobs/:id', '/library/jobs/:id'], requireJobAccess, async (req, res) =>
{
  if (req.remoteJob) return proxyToVm(req, res, `/library${req.path}`)
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })

    const { name } = req.body || {}
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (trimmed.length > MAX_JOB_NAME_LENGTH)
        return res.status(400).json({ error: `Name must be at most ${MAX_JOB_NAME_LENGTH} characters.` })

    const newName = trimmed || null
    const oldFile = sampleFileName(job)
    const newFile = pickSampleFileName(job, newName)
    if (newFile !== oldFile) {
        try {
            await fs.promises.rename(
                path.join(config.engineSamplesDir, oldFile),
                path.join(config.engineSamplesDir, newFile),
            )
        }
        catch (err) {
            // No copy yet (still processing, or trained before copies existed):
            // the new filename is still recorded, so the pipeline copies under it.
            if (err.code !== 'ENOENT')
                return res.status(409).json({ error: `Couldn't rename ${oldFile} in the engine samples folder (${err.code}). Close any program using it and try again.` })
        }
    }

  job.name = newName
  job.sampleFile = newFile
  saveJob(job)

  // Keep the shared library's copy in step. Best-effort: the local rename
  // already happened, so a VM that is down only leaves its old name.
  if (config.authMode === 'client' && isJobSynced(job.id))
  {
    const { status } = await forwardToVm('PATCH', `/library/jobs/${job.id}`, req.user, { name: newName ?? '' })
    if (status !== 200)
      console.warn(`[backend] library: renamed job ${job.id} here, but not on the VM (${status || 'unreachable'})`)
  }
  res.json({ id: job.id, name: job.name, sampleFile: newFile })
})

/************************************************************************/
/*!
  \brief
    Permanently delete a job: its photos, COLMAP files, splat output and
    the copy in the engine's samples folder. A job still processing is
    cancelled first so its tools stop writing into the folders. Only the
    job's owner or an admin can delete it. On a client machine, a job only
    in the VM's shared library is deleted there; a local job already sent
    to the VM is deleted from the VM first (otherwise it would come back
    in the Library from the VM's copy).
  \return
    401 if not logged in, 404 if job not found or isn't theirs, 502 if the
    VM's copy couldn't be deleted, else 200 once the folders are gone
*/
/************************************************************************/
app.delete(['/jobs/:id/files', '/library/jobs/:id/files'], requireJobAccess, async (req, res, next) =>
{
  if (req.remoteJob) return proxyToVm(req, res, `/library${req.path}`)
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'job not found' })

  if (config.authMode === 'client' && isJobSynced(job.id))
  {
    const { status } = await forwardToVm('DELETE', `/library/jobs/${job.id}/files`, req.user)
    if (status !== 200 && status !== 404)
      return res.status(502).json({ error: 'Couldn\'t delete it from the shared library. Try again shortly.' })
    unmarkJobSynced(job.id)
  }

  cancelJob(job) // no-op for a finished job
  jobs.delete(job.id)

    try {
        // Retries cover Windows briefly locking files of a tool that was just killed.
        const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }
        await fs.promises.rm(path.join(config.jobsDir, job.id), rmOpts)
        await fs.promises.rm(path.join(config.jobsDir, `${job.id}_out`), rmOpts)
        await fs.promises.rm(path.join(config.engineSamplesDir, sampleFileName(job)), { force: true })
        // Photos kept in the database (VM with FILE_STORE=db). No-op otherwise.
        deleteDbImages(job.id)
        res.json({ id: job.id, deleted: true })
    }
    catch (err) {
        next(err)
    }
})

// --- Shared library: receiving jobs (VM only) --------------------------------
// A client machine PUTs a finished job to /library/jobs/:id (the /library
// middleware has already checked the shared key). It is written to a hidden
// folder first (".incoming-..." -- scanJobs ignores names with a dot), checked,
// then moved into jobs/ in the normal layout, so it is served exactly like a
// job made on the VM.

/************************************************************************/
/*!
  \brief
    Refuses new library jobs when the VM's disk is nearly full, before any
    upload is written.
  \return
    507 if free space is below config.minFreeDiskGB
*/
/************************************************************************/
async function requireFreeDisk(_req, res, next)
{
  try
  {
    const stats = await fs.promises.statfs(config.jobsDir)
    const freeGB = (stats.bavail * stats.bsize) / 1024 ** 3
    if (freeGB < config.minFreeDiskGB)
    {
      console.warn(`[backend] library: refused job, only ${freeGB.toFixed(1)} GB free`)
      return res.status(507).json({ error: `The VM is low on disk space (${freeGB.toFixed(1)} GB free).` })
    }
    next()
  }
  catch (err)
  {
    next(err)
  }
}

/************************************************************************/
/*!
  \brief
    Checks the job id and makes the hidden staging folder the upload is
    written into (req.storeDir), laid out as <id>/images/ and <id>_out/.
  \return
    404 for an invalid id
*/
/************************************************************************/
function prepareStore(req, res, next)
{
  const { id } = req.params
  if (!JOB_ID_RE.test(id) || id.endsWith('_out')) return res.status(404).json({ error: 'job not found' })
  req.storeDir = path.join(config.jobsDir, `.incoming-${crypto.randomUUID()}`)
  fs.mkdirSync(path.join(req.storeDir, id, 'images'), { recursive: true })
  fs.mkdirSync(path.join(req.storeDir, `${id}_out`), { recursive: true })
  next()
}

// Photos keep the client's names (0000.jpg, ...) so their URLs stay the same;
// the model, metrics and cover get fixed names. Anything else is dropped.
const STORE_FILE_NAMES = { result: 'result.ply', metrics: 'metrics.json', cover: 'cover.webp' }
const storeUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) =>
      cb(null, file.fieldname === 'images'
        ? path.join(req.storeDir, req.params.id, 'images')
        : path.join(req.storeDir, `${req.params.id}_out`)),
    filename: (_req, file, cb) =>
      cb(null, file.fieldname === 'images' ? file.originalname : STORE_FILE_NAMES[file.fieldname]),
  }),
  limits: { fileSize: config.maxResultSizeMB * 1024 * 1024, files: config.maxFiles + 3 },
  fileFilter: (_req, file, cb) => cb(null,
    file.fieldname === 'images'
      ? /^[\w.-]+$/.test(file.originalname) && IMAGE_EXT_RE.test(file.originalname)
      : Object.hasOwn(STORE_FILE_NAMES, file.fieldname)),
})

/************************************************************************/
/*!
  \brief
    Reads the first bytes of a file (to check what it really is).
  \param filePath
  string
  \param count
  number
  \return
    Buffer of up to count bytes
*/
/************************************************************************/
async function readFileHead(filePath, count)
{
  const handle = await fs.promises.open(filePath)
  try
  {
    const head = Buffer.alloc(count)
    const { bytesRead } = await handle.read(head, 0, count, 0)
    return head.subarray(0, bytesRead)
  }
  finally
  {
    await handle.close()
  }
}

/************************************************************************/
/*!
  \brief
    VM only: store a finished job sent by a client machine. Multipart
    fields: images (photos), result (the .ply), metrics and cover
    (optional), status (the job's status.json as text), ownerId (the VM
    user id, or empty) and origin (the sending machine's name). Checks the
    photos are real JPEG/PNG, each under the photo size limit, the model is
    a .ply and the cover a WebP (a bad cover is just dropped). Writes a
    fresh status record (never trusting the sent paths), moves the job
    into jobs/ (replacing an earlier copy) and records its owner, origin
    and size. With FILE_STORE=db the photos go straight into the database
    instead of jobs/<id>/images/. An owner id the VM doesn't know becomes
    admin-only.
  \return
    400 on bad content, 409 if a job with this id is running on the VM,
    507 if the disk is nearly full, else 201 { id, bytes }
*/
/************************************************************************/
app.put('/library/jobs/:id', requireFreeDisk, prepareStore,
  storeUpload.fields([
    { name: 'images' },
    { name: 'result', maxCount: 1 },
    { name: 'metrics', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
  ]),
  async (req, res, next) =>
{
  const { id } = req.params
  const rmOpts = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }
  const reject = async (status, error) =>
  {
    await fs.promises.rm(req.storeDir, rmOpts)
    return res.status(status).json({ error })
  }

  try
  {
    const images = req.files?.images ?? []
    const result = req.files?.result?.[0]
    if (images.length === 0 || !result) return reject(400, 'A job needs its photos and result.ply.')

    const { fileTypeFromFile } = await import('file-type')
    for (const image of images)
    {
      if (image.size > config.maxFileSizeMB * 1024 * 1024)
        return reject(413, `Photo ${image.originalname} is over ${config.maxFileSizeMB} MB.`)
      const type = await fileTypeFromFile(image.path)
      if (!type || !['image/jpeg', 'image/png'].includes(type.mime))
        return reject(400, `Photo ${image.originalname} is not a real JPEG or PNG.`)
    }
    if ((await readFileHead(result.path, 3)).toString('latin1') !== 'ply')
      return reject(400, 'result.ply is not a .ply file.')

    // The cover is optional, so a bad one is dropped rather than refusing the job.
    const cover = req.files?.cover?.[0]
    if (cover)
    {
      const head = await readFileHead(cover.path, 12)
      const isWebp = head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
      if (!isWebp) await fs.promises.rm(cover.path, { force: true })
    }

    // A fresh status record: only harmless fields are taken from the client,
    // and the result path is always this job's own result.ply.
    let sent = {}
    try { sent = JSON.parse(req.body?.status ?? '{}') } catch { sent = {} }
    const record = {
      version: STATUS_VERSION,
      id,
      status: 'done',
      phase: 'done',
      progress: 1,
      detail: null,
      error: null,
      source: ['upload', 'youtube'].includes(sent.source) ? sent.source : null,
      name: typeof sent.name === 'string' ? sent.name.slice(0, MAX_JOB_NAME_LENGTH) : null,
      sampleFile: null,
      imageCount: images.length,
      removeBackground: sent.removeBackground === true,
      createdAt: Number.isFinite(sent.createdAt) ? sent.createdAt : Date.now(),
      updatedAt: Date.now(),
      result: `${id}_out/result.ply`,
      logTail: Array.isArray(sent.logTail) ? sent.logTail.slice(-40).map(String) : [],
    }
    fs.writeFileSync(path.join(req.storeDir, id, STATUS_FILE), JSON.stringify(record, null, 2))

    const live = jobs.get(id)
    if (live && !['done', 'error', 'cancelled'].includes(live.status))
      return reject(409, 'A job with this id is still running on the VM.')

    // FILE_STORE=db: the photos go into the database (replacing any earlier
    // copy's) instead of moving into jobs/<id>/images/ with the rest.
    if (imagesInDb)
    {
      const stagedImages = path.join(req.storeDir, id, 'images')
      storeJobImages(id, stagedImages)
      await fs.promises.rm(stagedImages, rmOpts)
    }

    // Replace any earlier copy, then move the checked job into place.
    jobs.delete(id)
    await fs.promises.rm(path.join(config.jobsDir, id), rmOpts)
    await fs.promises.rm(path.join(config.jobsDir, `${id}_out`), rmOpts)
    await fs.promises.rename(path.join(req.storeDir, id), path.join(config.jobsDir, id))
    await fs.promises.rename(path.join(req.storeDir, `${id}_out`), path.join(config.jobsDir, `${id}_out`))
    await fs.promises.rm(req.storeDir, rmOpts)

    const ownerNumber = Number(req.body?.ownerId)
    const ownerId = Number.isInteger(ownerNumber) && findUserById(ownerNumber) ? ownerNumber : null
    const origin = typeof req.body?.origin === 'string' ? req.body.origin.slice(0, 100) : null
    const bytes = [...images, result, ...(req.files?.metrics ?? []), ...(req.files?.cover ?? [])]
      .reduce((sum, f) => sum + f.size, 0)
    recordStoredJob(id, ownerId, origin, bytes)

    const scanned = await scanJob(id)
    if (scanned) restoreJob(scanned)
    console.log(`[backend] library: stored job ${id} from ${origin ?? 'unknown'} (${(bytes / 1024 ** 2).toFixed(1)} MB, owner ${ownerId ?? 'admin-only'})`)
    res.status(201).json({ id, bytes })
  }
  catch (err)
  {
    await fs.promises.rm(req.storeDir, rmOpts).catch(() => {})
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
function publicUser(user) {
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
/*
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
})*/


app.post('/auth/signup', limitByIp(signupIpLimiter), async (req, res, next) => {
    const { remember } = req.body || {}

    // Authority (VM) or local: the account lives in this machine's database.
    if (config.authMode !== 'client') {
        const input = validateSignup(req.body)
        if (input.error) return res.status(400).json({ error: input.error })
        try {
            const user = await createUser(input)
            startSession(res, user.id, remember === true)
            return res.status(201).json(publicUser(user))
        }
        catch (err) {
            if (err.code === 'EMAIL_TAKEN')
                return res.status(409).json({ error: 'An account with that email already exists.' })
            return next(err)
        }
    }

    // Client: forward to the VM, mirror the returned user, then start a local session.
    const problem = clientAuthProblem()
    if (problem) {
        console.error(`[backend] signup refused -- ${problem}`)
        return res.status(503).json({ error: 'Account service is not configured on this machine.' })
    }
    try {
        const { name, email, password } = req.body || {}
        const { status, data } = await callAuthority('/register', { name, email, password })
        if (status === 201) {
            upsertLocalUser(data)                 // mirror VM id -> local users
            startSession(res, data.id, remember === true)
            // The mirrored row, so memberSince comes from a real stored date.
            return res.status(201).json(publicUser(findUserByEmail(data.email)))
        }
        // The user's own mistakes (bad input, email taken, too many tries) pass through.
        if (status === 400 || status === 409 || status === 429)
            return res.status(status).json({ error: data.error || 'Signup failed.' })
        logAuthorityFailure('/register', status, data)
        res.status(503).json({ error: 'Account service is unavailable. Try again shortly.' })
    }
    catch (err) {
        console.error('[backend] account authority call failed:', err)
        res.status(503).json({ error: 'Account service is unavailable. Try again shortly.' })
    }
})


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
/*
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
})*/


app.post('/auth/login', limitByIp(loginIpLimiter), async (req, res, next) => {
    const { email, password, remember } = req.body || {}
    if (typeof email !== 'string' || typeof password !== 'string')
        return res.status(400).json({ error: 'Enter your email and password.' })

    // Authority (VM) or local: check this machine's database.
    if (config.authMode !== 'client') {
        try {
            const result = await checkCredentials(email, password)
            if (result.status === 'locked') {
                res.set('Retry-After', String(result.retryAfterSec))
                return res.status(429).json({ error: tooManyAttempts(result.retryAfterSec) })
            }
            if (result.status === 'invalid')
                return res.status(401).json({ error: 'Incorrect email or password.' })
            startSession(res, result.user.id, remember === true)
            return res.json(publicUser(result.user))
        }
        catch (err) { return next(err) }
    }

    // Client: verify against the VM, mirror the user, start a local session.
    const problem = clientAuthProblem()
    if (problem) {
        console.error(`[backend] login refused -- ${problem}`)
        return res.status(503).json({ error: 'Account service is not configured on this machine.' })
    }
    try {
        const { status, data } = await callAuthority('/verify-account', { email, password })
        if (status === 200 && data.valid) {
            upsertLocalUser(data)
            startSession(res, data.id, remember === true)
            // The mirrored row, so memberSince comes from a real stored date.
            return res.json(publicUser(findUserByEmail(data.email)))
        }
        if (status === 200)
            return res.status(401).json({ error: 'Incorrect email or password.' })
        if (status === 429)
            return res.status(429).json({ error: data.error || tooManyAttempts(0) })
        logAuthorityFailure('/verify-account', status, data)
        res.status(503).json({ error: 'Account service is unavailable. Try again shortly.' })
    }
    catch (err) {
        console.error('[backend] account authority call failed:', err)
        res.status(503).json({ error: 'Account service is unavailable. Try again shortly.' })
    }
})


/************************************************************************/
/*!
  \brief
    Who is logged in, according to the session cookie. Lets the frontend
    check a saved session is still valid (and pick up role changes).
  \return
    401 if not logged in, else the user
*/
/************************************************************************/
app.get('/auth/me', requireUser, (req, res) => {
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
app.post('/auth/logout', (req, res) => {
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

app.post('/register', requireAuthorityKey, async (req, res, next) => {
    const input = validateSignup(req.body)
    if (input.error) return res.status(400).json({ error: input.error })
    try {
        const user = await createUser(input)
        res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role })
    }
    catch (err) {
        if (err.code === 'EMAIL_TAKEN')
            return res.status(409).json({ error: 'An account with that email already exists.' })
        next(err)
    }
})


/************************************************************************/
/*!
  \brief
    Authority-only: check credentials against the VM's database. Unknown
    email and wrong password return the same { valid: false } so the
    endpoint can't be used to probe which emails are registered. Shares
    the per-email failure limit with this VM's own /auth/login.
  \return
    200 { valid: true, id, email, name, role } or { valid: false },
    429 when that email has had too many wrong passwords
*/
/************************************************************************/

app.post('/verify-account', requireAuthorityKey, async (req, res, next) => {
    const { email, password } = req.body || {}
    if (typeof email !== 'string' || typeof password !== 'string')
        return res.status(400).json({ error: 'Email and password required.' })
    try {
        const result = await checkCredentials(email, password)
        if (result.status === 'locked')
            return res.status(429).json({ error: tooManyAttempts(result.retryAfterSec) })
        if (result.status === 'invalid')
            return res.json({ valid: false })
        const { user } = result
        res.json({ valid: true, id: user.id, email: user.email, name: user.name, role: user.role })
    }
    catch (err) {
        next(err)
    }
})

/************************************************************************/
/*!
  \brief
    Start Google sign-in: redirect the browser to Google's consent screen.
    Authority (VM) only -- the redirect URI is registered against the VM.
    A random state goes both to Google and into a 10-minute HttpOnly
    cookie in this browser; the callback requires the two to match.
  \return
    302 to Google, or 503 if Google SSO isn't configured
*/
/************************************************************************/
app.get('/auth/google', (req, res) => {
    if (config.authMode !== 'authority' || !config.googleClientId)
        return res.status(503).json({ error: 'Google sign-in is not available here.' })

    const state = crypto.randomBytes(16).toString('base64url')
    // sameSite 'lax' is still sent on Google's redirect back, because that
    // is a normal top-level navigation.
    res.cookie(GOOGLE_STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure,
        path: GOOGLE_STATE_PATH,
        maxAge: 10 * 60 * 1000,
    })
    const params = new URLSearchParams({
        client_id: config.googleClientId,
        redirect_uri: config.googleRedirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        // Ask for a fresh account chooser each time.
        prompt: 'select_account',
    })
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

/************************************************************************/
/*!
  \brief
    Google redirects back here with ?code & ?state. Verify state against
    this browser's state cookie (one use only: the cookie is cleared
    straight away), exchange the code for tokens, read the verified
    email/name/sub from the ID token, find-or-create the account, start a
    session, go to the app.
  \return
    302 to "/" on success (logged in), or an error page/redirect on failure
*/
/************************************************************************/
app.get('/auth/google/callback', async (req, res) => {
    if (config.authMode !== 'authority') return res.status(503).send('Not available here.')
    const { code, state, error } = req.query

    const expectedState = readCookie(req, GOOGLE_STATE_COOKIE)
    res.clearCookie(GOOGLE_STATE_COOKIE, { path: GOOGLE_STATE_PATH })

    if (error) return res.redirect('/?login=google_denied')
    if (!code || !safeEqual(state, expectedState))
        return res.redirect('/?login=google_failed')

    try {
        // 1. Exchange the code for tokens (server-to-server, uses the secret).
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code: String(code),
                client_id: config.googleClientId,
                client_secret: config.googleClientSecret,
                redirect_uri: config.googleRedirectUri,
                grant_type: 'authorization_code',
            }),
            signal: AbortSignal.timeout(8000),
        })
        const tokens = await tokenResp.json()
        if (!tokenResp.ok || !tokens.id_token) return res.redirect('/?login=google_failed')

        // 2. The ID token is a JWT; its middle segment is the JSON claims. Google
        //    just issued it to us over TLS from its own endpoint, so for sign-in
        //    we read the claims directly. (A stricter check would verify Google's
        //    signature against its public keys; acceptable to skip when the token
        //    came straight from Google's token endpoint over HTTPS.)
        const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString())
        if (claims.aud !== config.googleClientId || !claims.email || !claims.email_verified)
            return res.redirect('/?login=google_failed')

        // 3. Find or create the account, link by email, start our own session.
        const user = findOrCreateGoogleUser({ sub: claims.sub, email: claims.email, name: claims.name })
        if (!user) {
            console.warn(`[backend] google sign-in refused: ${claims.email} is already linked to a different Google account`)
            return res.redirect('/?login=google_failed')
        }
        startSession(res, user.id, true)
        res.redirect('/')
    }
    catch (err) {
        console.error('[backend] google callback failed:', err)
        res.redirect('/?login=google_failed')
    }
})

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
  // Same for a shared-library upload rejected part-way (see prepareStore).
  if (req.storeDir) {
    try {
      fs.rmSync(req.storeDir, { recursive: true, force: true })
    } catch {
      // Already gone.
    }
  }
  // And a video upload (see videoUpload): videos are never kept.
  if (req.videoPath) {
    try {
      fs.rmSync(req.videoPath, { force: true })
    } catch {
      // Already gone.
    }
  }

    if (err instanceof multer.MulterError) {
        // The limits come from config (maxFileSizeMB, maxFiles, maxVideoSizeMB);
        // keep the messages in sync with those so they stay true if the limits change.
        const isVideoUpload = req.path === '/jobs/from-video'
        switch (err.code) {
            case 'LIMIT_FILE_SIZE':
                return res.status(413).json({
                    error: isVideoUpload
                        ? `That video is too large -- it must be under ${config.maxVideoSizeMB} MB.`
                        : `That file is too large -- each photo must be under ${config.maxFileSizeMB} MB.`,
                })
            case 'LIMIT_FILE_COUNT':
            case 'LIMIT_PART_COUNT':
            case 'LIMIT_UNEXPECTED_FILE':
                return res.status(400).json({
                    error: isVideoUpload
                        ? 'Upload one .mp4 video at a time.'
                        : `Too many files -- upload at most ${config.maxFiles} photos at once.`,
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

const server = app.listen(config.port, () =>
{
  console.log(`[backend] http://localhost:${config.port}`)
  console.log(`[backend] COLMAP: ${config.colmapBin}`)
  console.log(`[backend] Brush:  ${config.brushBin}`)
  console.log(`[backend] Python: ${config.pythonBin}`)
  console.log(`[backend] jobs:   ${config.jobsDir}`)
  // Which account mode this machine is in, and whether it can work.
  if (config.authMode === 'authority')
  {
    console.log('[backend] accounts: authority (this machine holds the account database)')
    if (!config.authApiKey)
      console.warn('[backend] *** AUTH_API_KEY is not set: other machines cannot sign up or log in. ***')
    console.log(`[backend] photos: ${imagesInDb ? 'stored in the database (FILE_STORE=db)' : 'stored as files in jobs/'}`)
  }
  else if (config.authMode === 'client')
  {
    console.log(`[backend] accounts: client -> ${config.vmAuthUrl}`)
    const problem = clientAuthProblem()
    if (problem) console.warn(`[backend] *** sign up / log in will not work: ${problem} ***`)
    else if (config.allowInsecureAuth && new URL(config.vmAuthUrl).protocol !== 'https:')
      console.warn('[backend] *** AUTH_ALLOW_HTTP=1: passwords are sent to the VM unencrypted. Testing only. ***')
    // Shared library: send finished jobs to the VM now, then as they finish
    // (afterJobEnds) and on a timer for retries.
    if (!problem) startLibrarySync()
    else console.warn('[backend] *** finished jobs will not be sent to the shared library until that is fixed. ***')
  }
  else
  {
    console.log('[backend] accounts: local (this machine\'s own database)')
  }
  // Probe hardware now (cached) so recording a job's metrics doesn't wait on it.
  getHardwareInfo().then((hw) =>
    console.log(`[backend] GPU:    ${hw.gpus?.map((g) => g.name).join(', ') || 'none detected'}`))
})
// Node cuts off any request that takes over 5 minutes, which a large video
// upload (or a shared-library job) on a slow connection can. Allow 30.
server.requestTimeout = 30 * 60_000
