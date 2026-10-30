/*!************************************************************************
\file imagestore.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 30-10-2026
\brief
On the VM with FILE_STORE=db, finished jobs' photos are kept inside the
database (app.db, table job_images) instead of as files in
jobs/<id>/images/. COLMAP and Brush need real files, so a job keeps its
images/ folder while it is being built; once it ends (done, failed or
cancelled) its photos move into the database and the folder is deleted.
Models, status.json, metrics.json and covers stay as files.
- moveImagesToDb(jobId)
Moves one job's photos into the database, deleting the folder only after
they are safely stored. Never throws.
- migrateImagesToDb()
Once at startup: backs up the database, then moves the photos of every job
that still has an images/ folder.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { backupDatabase, hasDbImages, storeJobImages } from './db.js'
import { IMAGE_EXT_RE, JOB_ID_RE } from './scan.js'

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
    await fs.promises.rm(imagesDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
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
    The one-time move when FILE_STORE=db is first turned on (and a safety
    net after any crash): finds every job folder that still has photos on
    disk and moves them. Run at startup, before jobs are restored, when
    nothing is being built. The database is backed up only before the
    first move (no photos in it yet): later backups would each copy every
    stored photo, and each job's move is already all-or-nothing.
  \return
    nothing; logs what it did
*/
/************************************************************************/
export async function migrateImagesToDb()
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
  const pending = entries
    .filter((e) => e.isDirectory() && JOB_ID_RE.test(e.name) && !e.name.endsWith('_out'))
    .map((e) => e.name)
    .filter(hasImagesOnDisk)
  if (pending.length === 0) return

  if (!hasDbImages())
  {
    const backupPath = backupDatabase()
    console.log(`[backend] photos: database backed up to ${backupPath} before moving photos in`)
  }

  let jobsMoved = 0
  let bytes = 0
  for (const jobId of pending)
  {
    const stored = await moveImagesToDb(jobId)
    if (stored)
    {
      jobsMoved++
      bytes += stored.bytes
    }
  }
  console.log(`[backend] photos: moved photos of ${jobsMoved} of ${pending.length} job(s) (${(bytes / 1024 ** 2).toFixed(1)} MB) into the database`)
}

// ----- End of Functions ----------------------------------------------------- //
