/*!************************************************************************
\file jobs.js
\author1 Gabriel Sebastian Putra
\author2 Xiong Yang
\author3 Ethan Ng
\par DP email1: gabrielsebastian.p@digipen.edu
\par DP email2: xiong.yang@digipen.edu
\par DP email3: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Business logic for reconstruction jobs that the routes share. No req / res.
Moved out of server.js. The pipeline itself is in pipeline.js.
- getJob(id)
Returns the job from the in-memory jobs map. If it isn't there, it looks for
the job's folder on disk (scanJob) and adopts it with restoreJob. This covers
folders that appeared after startup. Returns null if the job doesn't exist.
- parseTrainIters(value) / frameOptions(fps, maxFrames)
The per-job settings a new job is sent with, within the server's limits.
- ensureCover(jobId)
Makes the job's card cover (<id>_out/cover.webp) with tools/make_cover.py
the first time it is asked for: the object cut out of a photo with the
job's background masks. Concurrent requests share one run.
- queueBuild(job) / refreshQueue()
Puts a job's build (masks + COLMAP + Brush) in line (jobQueue.js): each
user runs config.maxRunningJobsPerUser builds at once (1), different users
at the same time, and the machine at most config.maxRunningJobs (0 = no
limit). Waiting jobs are 'queued', with what they wait for in job.detail.
refreshQueue() lets go of jobs cancelled while waiting.
- ensureThumbs(jobId) / thumbPath(jobId, name)
Makes small WebP copies of all the job's photos (<id>_out/thumbs/) with
tools/make_thumbs.py, for GET /jobs/:id/images/:name?size=small. One run
per job, shared by concurrent requests; at most 2 jobs at a time.
- afterJobEnds(job)
Runs once a job is done, failed or cancelled: makes the cover and the
thumbnails while the photos and masks exist, tidies up working files
(pruneJob), sends the job
to the VM (client machines) and, on the VM with FILE_STORE=db, moves its
model and photos into the database (dbstore.js).
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from '../config.js'
import { requestCleanup } from '../cleanup.js'
import { getDbImage, getJobOwnerId, listDbImageNames } from '../db.js'
import { moveImagesToDb, moveModelToDb } from '../dbstore.js'
import { createJobQueue } from '../jobQueue.js'
import { syncPendingJobs } from '../library.js'
import { jobs, pruneJob, restoreJob, runPipeline } from '../pipeline.js'
import { scanJob } from '../scan.js'
import { saveJob } from '../status.js'
import { clientAuthProblem } from './authority.js'

const filesInDb = config.filesInDb

export const MAX_JOB_NAME_LENGTH = 80

// Builds waiting their turn; see queueBuild. Builds are counted per owner
// (the user who started them); jobs without a recorded owner share one count.
const buildQueue = createJobQueue({
  maxPerOwner: config.maxRunningJobsPerUser,
  maxRunning: config.maxRunningJobs,
  ownerOf: jobOwner,
  onChange: showPlacesInLine,
})

// ----- Start of Functions --------------------------------------------------- //

// The user who started a job, or null (none recorded, or no database).
function jobOwner(job)
{
  try
  {
    return getJobOwnerId(job.id)
  }
  catch (err)
  {
    console.error(`[backend] job queue: no owner for ${job.id}:`, err.message)
    return null
  }
}

/************************************************************************/
/*!
  \brief
    Shows each waiting job what it waits for: status 'queued' (the
    website shows "Waiting to start") and, in job.detail, either its
    owner's earlier builds or the builds ahead of it on a full machine. A
    video job keeps its finished extraction on the bar.
  \param waiting
    The waiting jobs, first in line first, as { job, waitingFor, ahead }
    (see createJobQueue in jobQueue.js)
  \return
    nothing
*/
/************************************************************************/
function showPlacesInLine(waiting)
{
  waiting.forEach(({ job, waitingFor, ahead }) =>
  {
    const builds = `build${ahead === 1 ? '' : 's'}`
    const detail = waitingFor === 'own'
      ? `Waiting for your ${ahead === 1 ? 'earlier build' : `${ahead} earlier builds`} to finish`
      : `Waiting for ${ahead} ${builds} ahead of yours`
    if (job.status === 'queued' && job.detail === detail) return
    job.status = 'queued'
    job.phase = 'upload'
    job.progress = job.source === 'media' ? 0.05 : 0
    job.detail = detail
    saveJob(job)
  })
}

/************************************************************************/
/*!
  \brief
    Puts a job's build (background masks, COLMAP, Brush) in line: it
    starts now if its owner has fewer than config.maxRunningJobsPerUser
    builds running (and the machine is under config.maxRunningJobs, if
    set), else when the builds it waits for have ended. First come, first
    served among the builds allowed to start.
  \param job
    The job to build (its photos are in jobs/<id>/images/)
  \return
    Promise that settles once the build has ended (never rejects), or once
    the job was cancelled while waiting
*/
/************************************************************************/
export function queueBuild(job)
{
  return buildQueue.enqueue(job, () =>
  {
    job.detail = null
    return runPipeline(job)
  })
}

/************************************************************************/
/*!
  \brief
    Lets go of jobs cancelled while waiting, so the others' places update
    straight away. Call after cancelJob.
  \return
    nothing
*/
/************************************************************************/
export function refreshQueue()
{
  buildQueue.refresh()
}

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
export async function getJob(id) {
    const live = jobs.get(id)

    if (live)
        return live

    const record = await scanJob(id)

    return record ? (jobs.get(id) ?? restoreJob(record)) : null
}

/************************************************************************/
/*!
  \brief
    Read the optional training iteration cap the site sends with a new job
    (Low / Medium / High). Rounded to a whole number and clamped to
    config.minTrainIters..config.maxTrainIters.
  \param value
    The raw field value: a string from a multipart form, or a number from
    JSON.
  \return
    The iteration cap, or null (missing or not a positive number) to use
    config.trainIters.
*/
/************************************************************************/
export function parseTrainIters(value) {
    const iters = Math.round(Number(value))
    if (!Number.isFinite(iters) || iters <= 0) return null
    return Math.min(Math.max(iters, config.minTrainIters), config.maxTrainIters)
}

/************************************************************************/
/*!
  \brief
    The frame-extraction options sent with a Frame Extractor job, within
    the server's limits.
  \param fps
    Requested frames per second (any type; ignored unless a positive number)
  \param maxFrames
    Requested frame cap (any type; ignored unless a positive number)
  \return
    { fps?, maxFrames? } for runMediaPipeline
*/
/************************************************************************/
export function frameOptions(fps, maxFrames) {
    const opts = {}
    if (Number.isFinite(Number(fps)) && Number(fps) > 0) {
        opts.fps = Math.min(Number(fps), config.frameMaxFps)
    }
    if (Number.isFinite(Number(maxFrames)) && Number(maxFrames) > 0) {
        opts.maxFrames = Math.min(Number(maxFrames), config.maxFiles)
    }
    return opts
}

const execFileAsync = promisify(execFile)
// Covers being made right now, by job id, so cards asking at the same
// time share one run of make_cover.py.
const coversInProgress = new Map()
// When each job's cover last failed, so a cover that can't be made isn't
// retried on every visit, but a passing problem (a timeout on a busy
// machine) doesn't keep the job without one until the next restart.
const coversFailed = new Map()
const COVER_RETRY_MS = 10 * 60_000

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
export function ensureCover(jobId) {
    const coverPath = path.join(config.jobsDir, `${jobId}_out`, 'cover.webp')
    if (fs.existsSync(coverPath)) return Promise.resolve(coverPath)
    const failedAt = coversFailed.get(jobId)
    if (failedAt && Date.now() - failedAt < COVER_RETRY_MS) return Promise.reject(new Error('cover failed earlier'))
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
    making
        .then(() => coversFailed.delete(jobId), () => coversFailed.set(jobId, Date.now()))
        .finally(() => coversInProgress.delete(jobId))
    coversInProgress.set(jobId, making)
    return making
}

// Thumbnails being made right now, by job id, so cards asking at the same
// time share one run of make_thumbs.py.
const thumbsInProgress = new Map()
// When each job's thumbnails were last made (or failed). A missing one isn't
// tried again for THUMB_RETRY_MS, so a photo Pillow can't read, or a machine
// without Pillow, doesn't start Python on every card.
const thumbsLastRun = new Map()
const THUMB_RETRY_MS = 10 * 60_000
// Python processes making thumbnails at once; more requests wait their turn,
// so opening a large Library for the first time doesn't start dozens.
const THUMB_RUNS_AT_ONCE = 2
let thumbRunsActive = 0
const thumbRunQueue = []

// Waits for a free thumbnail run; releaseThumbRun() frees it.
function takeThumbRun()
{
  if (thumbRunsActive < THUMB_RUNS_AT_ONCE)
  {
    thumbRunsActive++
    return Promise.resolve()
  }
  return new Promise((resolve) => thumbRunQueue.push(resolve))
}

function releaseThumbRun()
{
  const next = thumbRunQueue.shift()
  if (next) next()
  else thumbRunsActive--
}

/************************************************************************/
/*!
  \brief
    Where a photo's small copy is kept: <id>_out/thumbs/<name>.webp. Under
    <id>_out, so deleting the job removes it and the VM's storage budget
    counts it.
  \param jobId
    string (already checked against JOB_ID_RE)
  \param name
    The photo's file name (already checked)
  \return
    string path (the file may not exist yet)
*/
/************************************************************************/
export function thumbPath(jobId, name)
{
  return path.join(config.jobsDir, `${jobId}_out`, 'thumbs', `${name}.webp`)
}

/************************************************************************/
/*!
  \brief
    Makes small WebP copies of every photo of a job that doesn't have one
    yet, with tools/make_thumbs.py: one Python run for the whole job. On
    the VM with FILE_STORE=db, photos no longer on disk are written to a
    temporary folder from the database first. Never rejects: a failure is
    logged, and the caller serves the original photo instead.
  \param jobId
    string (already checked against JOB_ID_RE)
  \param force
    true to run even if the job was done in the last THUMB_RETRY_MS (used
    when a job ends, before its photos move into the database)
  \return
    Promise, settled once the run is over
*/
/************************************************************************/
export function ensureThumbs(jobId, { force = false } = {})
{
  const running = thumbsInProgress.get(jobId)
  if (running) return force ? running.then(() => ensureThumbs(jobId, { force })) : running
  const lastRun = thumbsLastRun.get(jobId)
  if (!force && lastRun && Date.now() - lastRun < THUMB_RETRY_MS) return Promise.resolve()

  const making = (async () =>
  {
    await takeThumbRun()
    const thumbsDir = path.dirname(thumbPath(jobId, 'x'))
    let tempDir = null
    try
    {
      let imagesDir = path.join(config.jobsDir, jobId, 'images')
      if (!fs.existsSync(imagesDir))
      {
        if (!filesInDb) return
        // Only the photos still without a copy are written out.
        const missing = listDbImageNames(jobId).filter((name) => !fs.existsSync(thumbPath(jobId, name)))
        if (missing.length === 0) return
        tempDir = path.join(config.jobsDir, `${jobId}_out`, `thumbs-src-${process.pid}-${Date.now()}`)
        await fs.promises.mkdir(tempDir, { recursive: true })
        for (const name of missing)
        {
          const image = getDbImage(jobId, name)
          if (image) await fs.promises.writeFile(path.join(tempDir, name), image.data)
        }
        imagesDir = tempDir
      }
      await fs.promises.mkdir(thumbsDir, { recursive: true })
      await execFileAsync(
        config.pythonBin,
        [config.thumbScript, imagesDir, thumbsDir],
        { timeout: 120_000, windowsHide: true },
      )
    }
    catch (err)
    {
      console.warn(`[backend] no thumbnails for ${jobId}: ${err.stderr?.trim() || err.message}`)
    }
    finally
    {
      thumbsLastRun.set(jobId, Date.now())
      releaseThumbRun()
      if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })()
  thumbsInProgress.set(jobId, making)
  making.finally(() => thumbsInProgress.delete(jobId))
  return making
}

/************************************************************************/
/*!
  \brief
    Tidies up a job once it has ended (done, failed or cancelled), in an
    order that keeps what each step needs:
      1. done + background masks: make the cover now, while the photos
         and masks still exist (ensureCover);
      2. done: delete COLMAP/Brush working files and the masks (pruneJob);
      3. done, client machine: send it to the VM's shared library;
      4. done, VM with FILE_STORE=db: move its model into the database;
      5. make the photos' small copies (ensureThumbs), while they are
         still files;
      6. VM with FILE_STORE=db: move its photos into the database (also
         for failed / cancelled jobs, so their photos are kept).
    Never throws: each step logs its own problems.
  \param job
    The job whose pipeline just settled
  \return
    nothing
*/
/************************************************************************/
export async function afterJobEnds(job) {
    try {
        if (job.status === 'done') {
            if (fs.existsSync(path.join(config.jobsDir, job.id, 'masks'))) {
                await ensureCover(job.id).catch((err) =>
                    console.warn(`[backend] no cover for ${job.id}: ${err.stderr?.trim() || err.message}`))
            }
            await pruneJob(job)
            if (config.authMode === 'client' && !clientAuthProblem()) syncPendingJobs()
            if (filesInDb) await moveModelToDb(job)
        }
        await ensureThumbs(job.id, { force: true })
        if (filesInDb) await moveImagesToDb(job.id)
        // Storage just grew: the VM checks its budget (cleanup.js).
        if (config.authMode === 'authority') requestCleanup()
    }
    catch (err) {
        console.error(`[backend] tidying up job ${job.id} failed:`, err)
    }
}
