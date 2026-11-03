/*!************************************************************************
\file cleanup.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 01-11-2026
\brief
Keeps the VM's storage in check. Stored jobs (photos and model, in the
database or on disk) are kept under a size budget (STORAGE_BUDGET_GB):
when over, whole jobs are deleted, oldest first, until storage is down to
90% of the budget. Running jobs and jobs younger than CLEANUP_MIN_AGE_DAYS
are never deleted. Feedback older than FEEDBACK_KEEP_DAYS is deleted.
Database backups are not touched.
The budget counts the bytes each job stores, not the disk's free space:
deleting from app.db frees space inside the file, which SQLite reuses for
new jobs, but the file doesn't shrink, so free disk space wouldn't go up.
- deleteJobData(job)
Deletes a job everywhere: its folders, its engine samples copy, and its
photos and model in the database. Also used by DELETE /jobs/:id/files.
- jobStoredBytes(jobId)
How much storage a job takes (database + disk). Also used by the account
page's storage figure (GET /auth/me/storage).
- runCleanup()
One clean-up pass. Calls made while a pass is running share it.
- requestCleanup()
Runs a pass shortly (10 s) after a new job is stored; several requests in
that time make one pass.
- startCleanup()
Runs a pass now and then every CLEANUP_INTERVAL_MIN minutes.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { deleteDbImages, deleteDbModel, deleteOldFeedback, getDbJobBytes } from './db.js'
import { cancelJob, jobs, sampleFileName } from './pipeline.js'
import { scanJobs } from './scan.js'

// Delete down to this share of the budget, so the next job doesn't
// immediately push it over again (one deletion per job).
const TARGET_SHARE = 0.9
// After a new job, wait this long so a burst of jobs makes one pass.
const REQUEST_DELAY_MS = 10_000
const DAY_MS = 24 * 60 * 60 * 1000

// The pass in progress, if any (see runCleanup).
let currentRun = null
// A pass requested by requestCleanup, waiting to start.
let requestTimer = null

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    "212.4 MB" / "20.41 GB" for the log.
  \param bytes
  number
  \return
    string
*/
/************************************************************************/
function formatSize(bytes)
{
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

/************************************************************************/
/*!
  \brief
    Total size of the files in a folder and its subfolders.
  \param dir
  string
  \return
    bytes (0 if the folder doesn't exist)
*/
/************************************************************************/
async function folderBytes(dir)
{
  let entries
  try
  {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  }
  catch
  {
    return 0
  }
  let total = 0
  for (const entry of entries)
  {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await folderBytes(entryPath)
    else if (entry.isFile())
    {
      try
      {
        total += (await fs.promises.stat(entryPath)).size
      }
      catch
      {
        // Deleted while counting.
      }
    }
  }
  return total
}

/************************************************************************/
/*!
  \brief
    How much storage a job takes: its photos and model in the database
    plus its folders on disk (jobs/<id>/ and jobs/<id>_out/).
  \param jobId
  string
  \return
    bytes
*/
/************************************************************************/
export async function jobStoredBytes(jobId)
{
  return getDbJobBytes(jobId) +
    await folderBytes(path.join(config.jobsDir, jobId)) +
    await folderBytes(path.join(config.jobsDir, `${jobId}_out`))
}

/************************************************************************/
/*!
  \brief
    Deletes a job everywhere: cancels it if it is still running, then
    removes its folders, its copy in the engine's samples folder, and its
    photos and model in the database (VM with FILE_STORE=db; no-op
    otherwise). Throws if a folder can't be removed.
  \param job
    The job (or its scanned record: { id, status, sampleFile })
  \return
    nothing
*/
/************************************************************************/
export async function deleteJobData(job)
{
  cancelJob(job) // no-op for a finished job
  jobs.delete(job.id)
  // Retries cover Windows briefly locking files of a tool that was just killed.
  const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }
  await fs.promises.rm(path.join(config.jobsDir, job.id), rmOpts)
  await fs.promises.rm(path.join(config.jobsDir, `${job.id}_out`), rmOpts)
  await fs.promises.rm(path.join(config.engineSamplesDir, sampleFileName(job)), { force: true })
  deleteDbImages(job.id)
  deleteDbModel(job.id)
}

/************************************************************************/
/*!
  \brief
    Deletes the oldest jobs while stored jobs are over the budget, down to
    TARGET_SHARE of it. Running / queued jobs and jobs younger than
    config.cleanupMinAgeDays are skipped.
  \return
    nothing; logs each deletion and a summary
*/
/************************************************************************/
async function trimJobsToBudget()
{
  const budget = config.storageBudgetGB * 1024 ** 3
  const sized = []
  let total = 0
  for (const record of await scanJobs(config.jobsDir))
  {
    const bytes = await jobStoredBytes(record.id)
    sized.push({ record, bytes })
    total += bytes
  }
  if (total <= budget) return

  const startTotal = total
  const target = budget * TARGET_SHARE
  const newestDeletable = Date.now() - config.cleanupMinAgeDays * DAY_MS
  let deleted = 0
  // Oldest first: the jobs that were stored first go first.
  sized.sort((a, b) => a.record.createdAt - b.record.createdAt)
  for (const { record, bytes } of sized)
  {
    if (total <= target) break
    const live = jobs.get(record.id)
    const status = live?.status ?? record.status
    if (status === 'queued' || status === 'running') continue
    if (record.createdAt > newestDeletable) continue
    try
    {
      await deleteJobData(live ?? record)
    }
    catch (err)
    {
      console.error(`[backend] cleanup: couldn't delete job ${record.id}: ${err.message}`)
      continue
    }
    console.log(`[backend] cleanup: deleted job ${record.id} ("${record.name ?? 'unnamed'}", made ` +
      `${new Date(record.createdAt).toISOString().slice(0, 10)}, ${formatSize(bytes)}) -- ` +
      `storage was ${formatSize(total)} of ${config.storageBudgetGB} GB`)
    total -= bytes
    deleted++
  }

  console.log(`[backend] cleanup: deleted ${deleted} job(s), storage ${formatSize(startTotal)} -> ${formatSize(total)} ` +
    `(budget ${config.storageBudgetGB} GB)`)
  if (total > budget)
  {
    console.warn(`[backend] cleanup: still over the ${config.storageBudgetGB} GB budget: the remaining jobs are ` +
      `running or less than ${config.cleanupMinAgeDays} day(s) old. Raise STORAGE_BUDGET_GB or free space by hand.`)
  }
}

/************************************************************************/
/*!
  \brief
    One clean-up pass: old feedback, then jobs over the budget. If a pass
    is already running, returns that one instead of starting another, so
    two passes never delete at the same time. Never rejects.
  \return
    Promise that settles when the pass is done
*/
/************************************************************************/
export function runCleanup()
{
  if (currentRun) return currentRun
  currentRun = (async () =>
  {
    if (config.feedbackKeepDays > 0)
    {
      const removed = deleteOldFeedback(config.feedbackKeepDays)
      if (removed > 0)
        console.log(`[backend] cleanup: deleted ${removed} feedback message(s) older than ${config.feedbackKeepDays} days`)
    }
    if (config.storageBudgetGB > 0) await trimJobsToBudget()
  })()
    .catch((err) => console.error('[backend] cleanup failed:', err))
    .finally(() => { currentRun = null })
  return currentRun
}

/************************************************************************/
/*!
  \brief
    Asks for a pass soon, after a new job was stored (the only time
    storage grows). Requests within REQUEST_DELAY_MS make one pass.
  \return
    nothing
*/
/************************************************************************/
export function requestCleanup()
{
  if (requestTimer) return
  requestTimer = setTimeout(() =>
  {
    requestTimer = null
    runCleanup()
  }, REQUEST_DELAY_MS)
  requestTimer.unref() // never keeps the process alive on its own
}

/************************************************************************/
/*!
  \brief
    Runs a pass now, then every config.cleanupIntervalMin minutes.
  \return
    nothing
*/
/************************************************************************/
export function startCleanup()
{
  runCleanup()
  setInterval(runCleanup, config.cleanupIntervalMin * 60_000).unref()
}

// ----- End of Functions ----------------------------------------------------- //
