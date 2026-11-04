/*!************************************************************************
\file libraryStore.js
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
API layer: PUT /library/jobs/:id, the VM receiving a finished job from a
client machine (photos, result.ply, metrics.json, cover), checking it and
storing it like a VM-made job. Moved out of server.js.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { config } from '../config.js'
import { findUserById, recordStoredJob, storeJobImages, storeJobModel } from '../db.js'
import { requestCleanup } from '../cleanup.js'
import { jobs, restoreJob } from '../pipeline.js'
import { scanJob } from '../scan.js'
import { STATUS_FILE, STATUS_VERSION } from '../status.js'
import { prepareStore, readFileHead, requireFreeDisk, storeUpload } from '../middleware/uploads.js'
import { MAX_JOB_NAME_LENGTH } from '../services/jobs.js'

const router = express.Router()
const filesInDb = config.filesInDb

// ----- Start of Routes ------------------------------------------------------ //

// --- Shared library: receiving jobs (VM only) --------------------------------
// A client machine PUTs a finished job to /library/jobs/:id (the /library
// middleware has already checked the shared key). It is written to a hidden
// folder first (".incoming-..." -- scanJobs ignores names with a dot), checked,
// then moved into jobs/ in the normal layout, so it is served exactly like a
// job made on the VM.

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
    and size. With FILE_STORE=db the photos and model go straight into the
    database instead of jobs/. An owner id the VM doesn't know becomes
    admin-only.
  \return
    400 on bad content, 409 if a job with this id is running on the VM,
    507 if the disk is nearly full, else 201 { id, bytes }
*/
/************************************************************************/
router.put('/library/jobs/:id', requireFreeDisk, prepareStore,
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
      // 'youtube' and 'video': jobs from the old Video Extractor, still on some machines.
      source: ['upload', 'media', 'youtube', 'video'].includes(sent.source) ? sent.source : null,
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

    // FILE_STORE=db: the photos and the model go into the database (replacing
    // any earlier copy's) instead of moving into jobs/ with the rest. The
    // status record still names <id>_out/result.ply, which is then served
    // from the database.
    if (filesInDb)
    {
      const stagedImages = path.join(req.storeDir, id, 'images')
      storeJobImages(id, stagedImages)
      await fs.promises.rm(stagedImages, rmOpts)
      storeJobModel(id, result.path)
      await fs.promises.rm(result.path, { force: true })
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
    requestCleanup() // storage just grew: check the budget
    res.status(201).json({ id, bytes })
  }
  catch (err)
  {
    await fs.promises.rm(req.storeDir, rmOpts).catch(() => {})
    next(err)
  }
})

export default router
