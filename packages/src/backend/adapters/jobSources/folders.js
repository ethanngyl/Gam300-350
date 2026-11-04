/*!************************************************************************
\file folders.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Job source: the job folders on this machine (jobs/<id>/ with its
status.json, read by scan.js), merged with the jobs running in memory. On
the VM with FILE_STORE=db the photos and models are in the database, but
the folders still hold each job's status.json, so this source covers both.
- listJobs(user)
The user's jobs (an admin: every job) as JobSummary objects.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../../config.js'
import { listOwnedJobIds } from '../../db.js'
import { jobs, restoreJob } from '../../pipeline.js'
import { scanJobs } from '../../scan.js'
import { makeJobSummary } from './jobSummary.js'

export const name = 'folders'

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Every job folder that has images, newest first. The folders are
    scanned on each call, so photos and results from before a restart --
    or dropped in by hand -- show up. A job that is live in memory keeps
    its live status: the disk can't tell "running" from "interrupted".
  \param user
    req.user: admins get every job, other users only the jobs they created
  \return
    Promise of JobSummary[]
*/
/************************************************************************/
export async function listJobs(user)
{
  let records = await scanJobs(config.jobsDir)
  if (user.role !== 'admin')
  {
    const owned = listOwnedJobIds(user.id)
    records = records.filter((record) => owned.has(record.id))
  }
  return records.map((record) =>
  {
    const job = jobs.get(record.id) ?? restoreJob(record)
    return makeJobSummary({
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
    })
  })
}
// ----- End of Functions ----------------------------------------------------- //
