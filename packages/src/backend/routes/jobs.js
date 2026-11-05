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
API layer: the reconstruction job routes. Moved out of server.js. Each
also answers under /library/... on the VM for client machines (the
/library middleware in server.js checks the shared key first).
- POST /upload, POST /jobs/from-media
Start a job from photos, or from videos / GIFs (frames extracted first).
- GET /jobs, GET /jobs/:id, PATCH /jobs/:id, DELETE /jobs/:id,
  DELETE /jobs/:id/files
List, poll, rename, cancel and delete jobs (owner or admin).
- GET /jobs/:id/images/:name, GET /jobs/:id/result.ply,
  GET /jobs/:id/cover.webp
A job's photos, model and card cover.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { config } from '../config.js'
import { getDbImage, getDbModelInfo, isJobSynced, setJobOwner, unmarkJobSynced } from '../db.js'
import { deleteJobData } from '../cleanup.js'
import { forwardToVm, proxyToVm } from '../library.js'
import { cancelJob, makeJob, pickSampleFileName, runMediaPipeline, runPipeline, sampleFileName } from '../pipeline.js'
import { IMAGE_EXT_RE, JOB_ID_RE } from '../scan.js'
import { saveJob } from '../status.js'
import { requireJobAccess, requireUser } from '../middleware/session.js'
import { assignJobId, mediaUpload, onlyImages, onlyMedia, removeJobIfAborted, upload } from '../middleware/uploads.js'
import { sendDbModel } from '../middleware/sendDbModel.js'
import { MAX_JOB_NAME_LENGTH, afterJobEnds, ensureCover, frameOptions, getJob, parseTrainIters } from '../services/jobs.js'
import { listJobs } from '../adapters/jobSources/index.js'
import { catalog } from '../catalog.js'

const router = express.Router()
const filesInDb = config.filesInDb

// ----- Start of Routes ------------------------------------------------------ //

/************************************************************************/
/*!
  \brief
    Create a reconstruction job from uploaded photos. Returns a job id 
    immediately and runs COLMAP + Brush in the background -- the frontend 
    polls for status. The job is owned by the logged-in user. requireUser
    runs before assignJobId so a logged-out request never creates a folder.
  \return
    401 if not logged in, 400 if fewer than catalog.minPhotos (8) photos
    given, 202 if successful
*/
/************************************************************************/
router.post('/upload', requireUser, assignJobId, upload.array('images', config.maxFiles), onlyImages, (req, res) => {
    const files = req.files || []
    if (files.length < catalog.minPhotos) {
        // Reject cleanly: remove the job folder assignJobId created up front so a
        // too-small batch doesn't leave an orphan folder behind (same as onlyImages).
        fs.rmSync(path.join(config.jobsDir, req.jobId), { recursive: true, force: true })
        return res.status(400).json({
            error: `Need at least ${catalog.minPhotos} photos (got ${files.length}). More overlapping photos = better reconstruction.`,
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
    List the user's jobs, newest first, in the common JobSummary format
    (schemas/job-summary.schema.json). Where they come from is up to the
    job sources set by JOB_SOURCES (adapters/jobSources/): this machine's
    job folders, the VM's shared library on a team machine (a local copy
    wins; if the VM can't be reached, only local jobs are listed), and / or
    sample jobs. Admins get every job; other users only the jobs they
    created. Also served on the VM as /library/jobs.
  \return
    401 if not logged in, else JobSummary[]
*/
/************************************************************************/
router.get(['/jobs', '/library/jobs'], requireUser, async (req, res) => {
    res.json(await listJobs(req))
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
router.get(['/jobs/:id/images/:name', '/library/jobs/:id/images/:name'], requireJobAccess, (req, res) => {
    if (req.remoteJob) return proxyToVm(req, res, `/library${req.path}`)
    const { id, name } = req.params
    if (!JOB_ID_RE.test(id) || !/^[\w.-]+$/.test(name) || !IMAGE_EXT_RE.test(name)) {
        return res.status(404).json({ error: 'image not found' })
    }
    const filePath = path.join(config.jobsDir, id, 'images', name)
    if (!fs.existsSync(filePath) && filesInDb) {
        const image = getDbImage(id, name)
        if (!image) return res.status(404).json({ error: 'image not found' })
        res.type(image.mime)
        res.setHeader('Cache-Control', 'private, max-age=3600')
        return res.send(image.data)
    }
    res.sendFile(filePath, (err) => {
        if (err && !res.headersSent) res.status(404).json({ error: 'image not found' })
    })
})

/************************************************************************/
/*!
  \brief
    Create a reconstruction job from uploaded videos / GIFs. Frames are
    extracted server side (tools/extract_frames.py) into the job's images/
    folder, then the same COLMAP + Brush pipeline runs. Multipart body: media
    (the files), and the optional text fields fps, maxFrames, trainIters and
    removeBackground.
    The job is owned by the logged-in user. requireUser runs before
    assignJobId so a logged-out request never creates a folder.
  \return
    401 if not logged in, 400 if no usable files were sent, else 202 and
    starts a job and runs the media pipeline
*/
/************************************************************************/
router.post('/jobs/from-media', requireUser, assignJobId, removeJobIfAborted, mediaUpload.array('media', config.maxMediaFiles), onlyMedia, (req, res) => {
    // The browser hung up after sending the files but before this reply
    // (closed tab, refresh, lost connection): it would never learn the job's
    // id, so don't start a job nobody can see or stop. Remove its folder here
    // too: removeJobIfAborted's removal can run while the files are still
    // being written, and leave the folder behind.
    if (res.destroyed) {
        fs.promises.rm(path.join(config.jobsDir, req.jobId), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
            .catch(() => { })
        return
    }
    if (!req.files?.length) {
        fs.rmSync(path.join(config.jobsDir, req.jobId), { recursive: true, force: true })
        return res.status(400).json({ error: 'Please upload at least one video or animated GIF.' })
    }

    const { fps, maxFrames, trainIters } = req.body || {}
    setJobOwner(req.jobId, req.user.id)
    const job = makeJob(req.jobId)
    job.source = 'media'
    // Mask out the background before COLMAP, see generateMasks in pipeline.js.
    job.removeBackground = ['true', '1', 'on'].includes(String(req.body?.removeBackground).toLowerCase())
    job.trainIters = parseTrainIters(trainIters)
    saveJob(job)

    // fire-and-forget; the frontend polls /jobs/:id. Tidied up once it ends.
    runMediaPipeline(job, frameOptions(fps, maxFrames)).finally(() => afterJobEnds(job))
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
router.get(['/jobs/:id', '/library/jobs/:id'], requireJobAccess, async (req, res) => {
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
router.delete(['/jobs/:id', '/library/jobs/:id'], requireJobAccess, async (req, res) => {
    if (req.remoteJob) return proxyToVm(req, res, `/library${req.path}`)
    const job = await getJob(req.params.id)
    if (!job) return res.status(404).json({ error: 'job not found' })
    if (job.status === 'cancelled') return res.json({ id: job.id, status: job.status })
    if (!cancelJob(job)) {
        return res.status(409).json({ error: `job already ${job.status}` })
    }
    res.json({ id: job.id, status: job.status })
})

/************************************************************************/
/*!
  \brief
    Download / stream the finished splat .ply. Owner or admin only. On
    the VM with FILE_STORE=db, a model no longer on disk is served from
    the database (sendDbModel).
  \return
    401 if not logged in, 404 if result is not ready or isn't theirs
*/
/************************************************************************/
router.get(['/jobs/:id/result.ply', '/library/jobs/:id/result.ply'], requireJobAccess, async (req, res) => {
    if (req.remoteJob) return proxyToVm(req, res, `/library${req.path}`)
    const job = await getJob(req.params.id)
    if (!job || job.status !== 'done' || !job.resultPath) {
        return res.status(404).json({ error: 'result not ready' })
    }
    if (filesInDb && !fs.existsSync(job.resultPath)) {
        const info = getDbModelInfo(job.id)
        if (!info) return res.status(404).json({ error: 'result not ready' })
        return sendDbModel(req, res, job.id, info)
    }
    res.setHeader('Content-Type', 'application/octet-stream')
    res.sendFile(job.resultPath)
})

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
router.get(['/jobs/:id/cover.webp', '/library/jobs/:id/cover.webp'], requireJobAccess, async (req, res) => {
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
router.patch(['/jobs/:id', '/library/jobs/:id'], requireJobAccess, async (req, res) => {
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
    if (config.authMode === 'client' && isJobSynced(job.id)) {
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
router.delete(['/jobs/:id/files', '/library/jobs/:id/files'], requireJobAccess, async (req, res, next) => {
    if (req.remoteJob) return proxyToVm(req, res, `/library${req.path}`)
    const job = await getJob(req.params.id)
    if (!job) return res.status(404).json({ error: 'job not found' })

    if (config.authMode === 'client' && isJobSynced(job.id)) {
        const { status } = await forwardToVm('DELETE', `/library/jobs/${job.id}/files`, req.user)
        if (status !== 200 && status !== 404)
            return res.status(502).json({ error: 'Couldn\'t delete it from the shared library. Try again shortly.' })
        unmarkJobSynced(job.id)
    }

    try {
        // Cancels it if still running, then removes its folders, samples copy and
        // database photos / model (the same as the VM's clean-up, cleanup.js).
        await deleteJobData(job)
        res.json({ id: job.id, deleted: true })
    }
    catch (err) {
        next(err)
    }
})

export default router
