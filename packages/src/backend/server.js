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
The entry point of the Express backend: startup, wiring and shutdown. It
serves the built React frontend and the HTTP API the website (and the
engine) use to turn photos or videos into a Gaussian Splat .ply with COLMAP
and Brush. The backend is split into layers (see docs/architecture.md):
- routes/ (API layer)
jobs.js, sampleJobs.js, libraryStore.js, auth.js, account.js, feedback.js,
scenes.js, catalog.js, docs.js and metrics.js: one Express Router each. They read the request,
call the layers below and reply with JSON or file data only. All of them
are served at /api/v1/... and at the old unversioned paths.
- adapters/ (between the API and the data)
apiVersions.js (v1 vs legacy reply shapes) and jobSources/ (one adapter per
place jobs come from, set by JOB_SOURCES).
- middleware/ (API layer)
session.js (who is calling, access rules), limits.js (429s), uploads.js
(multer and file checks), sendDbModel.js, errors.js (JSON 404s and the
JSON error handler) and timing.js (times every API request).
- services/ (business logic, no req / res)
jobs.js, accounts.js, authority.js, feedback.js, google.js, scenes.js and
performance.js (response and page-load times, p50 / p95 / p99); with
pipeline.js (COLMAP / Brush), library.js (sending jobs to the VM),
cleanup.js, metrics.js, scan.js and status.js.
- db.js and dbstore.js (data)
The only files with SQL. The tables come from migrations/ (migrate.js).
- catalog/, schemas/, sample-data/ (data files)
Reference data, the JSON Schema of every saved / sent format, sample jobs.
- config.js
Every setting, from environment variables (.env, see .env.example).
At startup this file rebuilds the job list from disk, removes leftovers
from interrupted uploads, mounts the routes and starts the VM clean-up or
the client's library sync.
- shutdown(reason, exitCode)
Runs only once. Marks every running job as error and saves it, calls
killChildren() to stop the COLMAP/Brush/python processes, then exits.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { saveJob } from './status.js'
import { getHardwareInfo } from './metrics.js'
import { getDbModelInfo, listDbImageNames, retireLocalAccounts } from './db.js'
import { migrateToDb } from './dbstore.js'
import { startCleanup } from './cleanup.js'
import { startLibrarySync } from './library.js'
import { scanJobs, setImageNameSource, setModelSource } from './scan.js'
import { jobs, killChildren, restoreJob, setSkipSampleCopy } from './pipeline.js'
import { actAsUser, loadUser, requireAuthorityKey } from './middleware/session.js'
import { jsonErrorHandler, jsonNotFound } from './middleware/errors.js'
import { clientAuthProblem } from './services/authority.js'
import { googleSignInReady } from './services/google.js'
import jobRoutes from './routes/jobs.js'
import libraryStoreRoutes from './routes/libraryStore.js'
import authRoutes from './routes/auth.js'
import accountRoutes from './routes/account.js'
import feedbackRoutes from './routes/feedback.js'
import catalogRoutes from './routes/catalog.js'
import docsRoutes from './routes/docs.js'
import sampleJobRoutes from './routes/sampleJobs.js'
import sceneRoutes from './routes/scenes.js'
import metricsRoutes from './routes/metrics.js'
import { timeRequests } from './middleware/timing.js'
import { flushTimings, startPerformance } from './services/performance.js'
import { API_V1_PREFIX, markLegacy } from './adapters/apiVersions.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

fs.mkdirSync(config.jobsDir, { recursive: true })

// Photos and models in the database (FILE_STORE=db) is for the VM only:
// other machines (localhost) build models from files on disk, keep them
// there, and send them to the VM.
const filesInDb = config.filesInDb
if (config.fileStore === 'db' && !filesInDb)
  console.warn('[backend] FILE_STORE=db is ignored: it only applies with AUTH_MODE=authority (the VM).')
if (filesInDb)
{
  // Jobs whose photos / model have moved into the database are still listed
  // (and stay done), and any still on disk (first start, or after a crash)
  // move in now. No model copies go into the engine's samples folder.
  setImageNameSource(listDbImageNames)
  setModelSource((jobId) => Boolean(getDbModelInfo(jobId)))
  setSkipSampleCopy(true)
  await migrateToDb()
}

// Jobs live in memory, so rebuild them from the job folders on disk. Without
// this, everything finished before a restart 404s on /jobs/:id and result.ply.
const restored = await scanJobs(config.jobsDir)

for (const record of restored) {
    if (!jobs.has(record.id)) {
        restoreJob(record)
    }
}

console.log(`[backend] restored ${restored.length} job(s) from ${config.jobsDir}`)

// Staging folders left by shared-library uploads cut off mid-way (crash or
// restart during a PUT /library/jobs/:id). Their jobs are re-sent later.
// Also videos left by the old Video Extractor's upload (.video-<id>.mp4), and
// Frame Extractor uploads (a job's media/ folder) left by a stop during the
// upload or frame extraction. No job is running yet, so any media/ is left over.
for (const entry of fs.readdirSync(config.jobsDir))
{
  if (entry.startsWith('.incoming-') || entry.startsWith('.video-'))
  {
    fs.rmSync(path.join(config.jobsDir, entry), { recursive: true, force: true })
    continue
  }
  const mediaDir = path.join(config.jobsDir, entry, 'media')
  if (fs.existsSync(mediaDir))
  {
    fs.rmSync(mediaDir, { recursive: true, force: true })
    console.log(`[backend] removed uploaded videos left in job ${entry}`)
  }
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

// Time every API request (first, so body parsing counts too); see
// services/performance.js and GET /api/v1/metrics/performance.
app.use(timeRequests)
startPerformance()

// Parse JSON bodies. Only applies to application/json requests, so the
// multipart photo and media uploads are unaffected. Express's default 100 KB
// is too small for a large saved scene (config.maxJsonBodyMB).
app.use(express.json({ limit: `${config.maxJsonBodyMB}mb` }))

// Serve the built React frontend (run `npm run build` to produce web-app/dist).
app.use(express.static(path.join(__dirname, '../web-app/dist')))

// Work out who is calling (from the session cookie) before any route runs.
app.use(loadUser)

// The API (routes/), built once and served twice (docs/api-changelog.md):
// at /api/v1/... and at the old unversioned paths, which stay as they were
// for the website, the engine and older machines. Routes tell the two apart
// with adapters/apiVersions.js.
const api = express.Router()

// Shared library (VM only): client machines reach the same job routes under
// /library/..., with the shared key instead of a cookie, acting as the user
// they name. 503 on any machine that isn't the account authority.
api.use('/library', requireAuthorityKey, actAsUser)

// Each Router holds full paths, so the order only matters where two match
// the same path: sample jobs answer for their own ids before the job routes.
api.use(catalogRoutes)
api.use(docsRoutes)
api.use(sampleJobRoutes)
api.use(jobRoutes)
api.use(libraryStoreRoutes)
api.use(authRoutes)
api.use(accountRoutes)
api.use(feedbackRoutes)
api.use(sceneRoutes)
api.use(metricsRoutes)

app.use(API_V1_PREFIX, api)
// Legacy: the same routes, marked deprecated (Deprecation / Link headers).
app.use(markLegacy, api)

// JSON replies for unknown paths and errors (must be after every route).
app.use(jsonNotFound)
app.use(jsonErrorHandler)

// ----- Start of Functions --------------------------------------------------- //

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
    // Save the performance measurements not yet written.
    flushTimings()
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
    console.log(`[backend] files: ${filesInDb ? 'photos and models stored in the database (FILE_STORE=db)' : 'photos and models stored as files in jobs/'}`)
    // Clean-up (cleanup.js): oldest jobs over the budget, old feedback.
    const jobRule = config.storageBudgetGB > 0
      ? `jobs kept under ${config.storageBudgetGB} GB (oldest deleted first, never the last ${config.cleanupMinAgeDays} day(s))`
      : 'jobs are never deleted (STORAGE_BUDGET_GB not set)'
    const feedbackRule = config.feedbackKeepDays > 0 ? `feedback kept ${config.feedbackKeepDays} days` : 'feedback kept forever'
    console.log(`[backend] storage: ${jobRule}; ${feedbackRule}`)
    if (config.googleClientId && !googleSignInReady())
      console.warn('[backend] *** GOOGLE_REDIRECT_URI is not set: Google sign-in is off. ***')
    startCleanup()
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
