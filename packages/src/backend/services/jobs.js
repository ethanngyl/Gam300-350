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
- afterJobEnds(job)
Runs once a job is done, failed or cancelled: makes the cover while the
photos and masks exist, tidies up working files (pruneJob), sends the job
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
import { moveImagesToDb, moveModelToDb } from '../dbstore.js'
import { syncPendingJobs } from '../library.js'
import { jobs, pruneJob, restoreJob } from '../pipeline.js'
import { scanJob } from '../scan.js'
import { clientAuthProblem } from './authority.js'

const filesInDb = config.filesInDb

export const MAX_JOB_NAME_LENGTH = 80

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
export function ensureCover(jobId) {
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
    Tidies up a job once it has ended (done, failed or cancelled), in an
    order that keeps what each step needs:
      1. done + background masks: make the cover now, while the photos
         and masks still exist (ensureCover);
      2. done: delete COLMAP/Brush working files and the masks (pruneJob);
      3. done, client machine: send it to the VM's shared library;
      4. done, VM with FILE_STORE=db: move its model into the database;
      5. VM with FILE_STORE=db: move its photos into the database (also
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
        if (filesInDb) await moveImagesToDb(job.id)
        // Storage just grew: the VM checks its budget (cleanup.js).
        if (config.authMode === 'authority') requestCleanup()
    }
    catch (err) {
        console.error(`[backend] tidying up job ${job.id} failed:`, err)
    }
}
