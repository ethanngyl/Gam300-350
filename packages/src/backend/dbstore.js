/*!************************************************************************
\file dbstore.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 31-10-2026
\brief
On the VM with FILE_STORE=db, finished jobs' photos and models are kept
inside the database (app.db: table job_images, and job_models /
job_model_chunks) instead of as files in jobs/<id>/images/ and
jobs/<id>_out/. COLMAP and Brush need real files, so a job keeps them while
it is being built; once it ends its photos move into the database (done,
failed or cancelled), and so does its model (done). status.json,
metrics.json and covers stay as files. The VM also keeps no copy of models
in the engine's samples folder.
- moveImagesToDb(jobId)
Moves one job's photos into the database, deleting the folder only after
they are safely stored. Never throws.
- moveModelToDb(job)
Moves one finished job's model into the database, deleting the file (and
its engine samples copy) only after it is safely stored. Never throws.
- migrateToDb()
Once at startup: backs up the database if this is the first move, then
moves the photos and models still on disk, and removes leftover engine
samples copies.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { backupDatabase, getDbModelInfo, hasDbImages, hasDbModels, storeJobImages, storeJobModel } from './db.js'
import { sampleFileName } from './pipeline.js'
import { IMAGE_EXT_RE, JOB_ID_RE } from './scan.js'
import { readStatus } from './status.js'

const RM_OPTS = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    True if a job folder still has photos on disk.
  \param jobId
  string
  \return
    bool
*/
/************************************************************************/
function hasImagesOnDisk(jobId)
{
  try
  {
    return fs.readdirSync(path.join(config.jobsDir, jobId, 'images')).some((n) => IMAGE_EXT_RE.test(n))
  }
  catch
  {
    return false
  }
}

/************************************************************************/
/*!
  \brief
    Deletes a job's copy in the engine's samples folder, if there is one.
    Only the job's own file is touched: its name is the short job id or
    one picked on rename that never matches an existing file (see
    pickSampleFileName), so the repo's own sample .ply files are safe.
  \param job
    { id, sampleFile } -- a job or a status.json record
  \return
    true if a copy was deleted
*/
/************************************************************************/
async function removeSampleCopy(job)
{
  const samplePath = path.join(config.engineSamplesDir, sampleFileName(job))
  if (!fs.existsSync(samplePath)) return false
  try
  {
    await fs.promises.rm(samplePath, { force: true, maxRetries: 5, retryDelay: 200 })
    return true
  }
  catch (err)
  {
    console.warn(`[backend] couldn't delete the engine samples copy ${samplePath}: ${err.message}`)
    return false
  }
}

/************************************************************************/
/*!
  \brief
    Moves one job's photos from jobs/<id>/images/ into the database. The
    folder is deleted only after every photo is stored (storeJobImages is
    one transaction), so a failure leaves the photos where they were.
    Never throws: problems are logged.
  \param jobId
  string
  \return
    { count, bytes } if photos were moved, else null
*/
/************************************************************************/
export async function moveImagesToDb(jobId)
{
  if (!hasImagesOnDisk(jobId)) return null
  const imagesDir = path.join(config.jobsDir, jobId, 'images')
  let stored
  try
  {
    stored = storeJobImages(jobId, imagesDir)
  }
  catch (err)
  {
    console.error(`[backend] photos of job ${jobId} stay on disk -- could not store them in the database: ${err.message}`)
    return null
  }
  try
  {
    await fs.promises.rm(imagesDir, RM_OPTS)
  }
  catch (err)
  {
    // Stored safely; only the leftover copy remains. Served from disk until removed.
    console.warn(`[backend] photos of job ${jobId} are in the database, but the folder couldn't be deleted: ${err.message}`)
  }
  return stored
}

/************************************************************************/
/*!
  \brief
    Moves a finished job's model (its result file, normally
    jobs/<id>_out/result.ply) into the database, then deletes the file and
    the job's engine samples copy. The file is deleted only after the
    whole model is stored (storeJobModel is one transaction), so a failure
    leaves it where it was. job.resultPath is left as it is: it still
    names the model, and GET result.ply serves it from the database once
    the file is gone. Never throws: problems are logged.
  \param job
    { id, resultPath, sampleFile } -- a job, or the same fields from its
    status.json
  \return
    { size } if the model was moved, else null
*/
/************************************************************************/
export async function moveModelToDb(job)
{
  if (!job.resultPath || !fs.existsSync(job.resultPath)) return null
  let stored
  try
  {
    stored = storeJobModel(job.id, job.resultPath)
  }
  catch (err)
  {
    console.error(`[backend] model of job ${job.id} stays on disk -- could not store it in the database: ${err.message}`)
    return null
  }
  try
  {
    await fs.promises.rm(job.resultPath, RM_OPTS)
  }
  catch (err)
  {
    // Stored safely; only the leftover copy remains. Served from disk until removed.
    console.warn(`[backend] model of job ${job.id} is in the database, but the file couldn't be deleted: ${err.message}`)
  }
  await removeSampleCopy(job)
  return stored
}

/************************************************************************/
/*!
  \brief
    The one-time move when FILE_STORE=db is first turned on (and a safety
    net after any crash): finds every job that still has photos, or a
    finished model, on disk and moves them into the database. Also
    removes engine samples copies of models already in the database. Run
    at startup, before jobs are restored, when nothing is being built.
    The database is backed up once, before a kind of file is first moved
    in: later backups would each copy every stored file, and each job's
    move is already all-or-nothing.
  \return
    nothing; logs what it did
*/
/************************************************************************/
export async function migrateToDb()
{
  let entries
  try
  {
    entries = fs.readdirSync(config.jobsDir, { withFileTypes: true })
  }
  catch
  {
    return
  }
  const jobIds = entries
    .filter((e) => e.isDirectory() && JOB_ID_RE.test(e.name) && !e.name.endsWith('_out'))
    .map((e) => e.name)

  const photosPending = jobIds.filter(hasImagesOnDisk)
  // Finished jobs, as { id, resultPath, sampleFile } from their status.json.
  const finished = []
  for (const id of jobIds)
  {
    const saved = await readStatus(id)
    if (saved?.status === 'done' && saved.result)
      finished.push({ id, resultPath: path.join(config.jobsDir, saved.result), sampleFile: saved.sampleFile })
  }
  const modelsPending = finished.filter((job) => fs.existsSync(job.resultPath))

  if ((photosPending.length > 0 && !hasDbImages()) || (modelsPending.length > 0 && !hasDbModels()))
  {
    const backupPath = backupDatabase()
    console.log(`[backend] files: database backed up to ${backupPath} before moving files in`)
  }

  if (photosPending.length > 0)
  {
    let jobsMoved = 0
    let bytes = 0
    for (const jobId of photosPending)
    {
      const stored = await moveImagesToDb(jobId)
      if (stored)
      {
        jobsMoved++
        bytes += stored.bytes
      }
    }
    console.log(`[backend] files: moved photos of ${jobsMoved} of ${photosPending.length} job(s) (${(bytes / 1024 ** 2).toFixed(1)} MB) into the database`)
  }

  if (modelsPending.length > 0)
  {
    let moved = 0
    let bytes = 0
    for (const job of modelsPending)
    {
      const stored = await moveModelToDb(job)
      if (stored)
      {
        moved++
        bytes += stored.size
      }
    }
    console.log(`[backend] files: moved ${moved} of ${modelsPending.length} model(s) (${(bytes / 1024 ** 2).toFixed(1)} MB) into the database`)
  }

  // Engine samples copies made before the models moved (or left by a crash).
  let copiesRemoved = 0
  for (const job of finished)
  {
    if (getDbModelInfo(job.id) && await removeSampleCopy(job)) copiesRemoved++
  }
  if (copiesRemoved > 0)
    console.log(`[backend] files: removed ${copiesRemoved} model copy(ies) from ${config.engineSamplesDir}`)
}

// ----- End of Functions ----------------------------------------------------- //
