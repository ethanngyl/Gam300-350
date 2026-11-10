/*!************************************************************************
\file jobSummary.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
The common format every job source converts its jobs into: the JobSummary
that GET /jobs lists (schemas/job-summary.schema.json). The rest of the
backend and every client only see this format, so a source can be added or
swapped (folders on disk, the VM's library, sample data) without changing
them.
- JOB_STATUSES
The statuses a job can have.
- makeJobSummary(fields)
A JobSummary with exactly the known fields, missing ones filled in.
- normalizeJobSummary(raw)
Checks and converts a job from an outside source (e.g. the VM's JSON):
dates in any form become milliseconds, unknown fields are dropped. null if
it isn't a usable job.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { JOB_ID_RE } from '../../scan.js'
import { toMs } from '../apiVersions.js'

export const JOB_STATUSES = new Set(['queued', 'running', 'done', 'error', 'cancelled'])

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Builds a JobSummary: the fields in schema order, defaults for the ones
    not given, nothing else.
  \param fields
    { id, name, status, phase, progress, detail, error, createdAt,
      updatedAt, imageCount, hasResult, thumbnail, cover, images }
  \return
    JobSummary
*/
/************************************************************************/
export function makeJobSummary(fields)
{
  return {
    id: fields.id,
    name: fields.name ?? null,
    status: fields.status,
    phase: fields.phase ?? null,
    progress: typeof fields.progress === 'number' ? fields.progress : 0,
    detail: fields.detail ?? null,
    error: fields.error ?? null,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt ?? fields.createdAt,
    imageCount: fields.imageCount ?? 0,
    hasResult: Boolean(fields.hasResult),
    thumbnail: fields.thumbnail ?? null,
    cover: fields.cover ?? null,
    images: fields.images ?? [],
  }
}

/************************************************************************/
/*!
  \brief
    Turns a job from another system into a JobSummary, or rejects it.
  \param raw
    any (one item of a JSON list)
  \return
    JobSummary, or null when there is no valid id, status or creation date
*/
/************************************************************************/
export function normalizeJobSummary(raw)
{
  if (!raw || typeof raw !== 'object') return null
  const createdAt = toMs(raw.createdAt)
  if (typeof raw.id !== 'string' || !JOB_ID_RE.test(raw.id) || !JOB_STATUSES.has(raw.status) || createdAt === null)
    return null
  const text = (value) => (typeof value === 'string' ? value : null)
  const images = Array.isArray(raw.images)
    ? raw.images
      .filter((image) => typeof image?.name === 'string' && typeof image?.url === 'string')
      .map((image) => ({ name: image.name, url: image.url }))
    : []
  return makeJobSummary({
    id: raw.id,
    name: text(raw.name),
    status: raw.status,
    phase: text(raw.phase),
    progress: Number.isFinite(raw.progress) ? Math.min(Math.max(raw.progress, 0), 1) : 0,
    detail: text(raw.detail),
    error: text(raw.error),
    createdAt,
    updatedAt: toMs(raw.updatedAt) ?? createdAt,
    imageCount: Number.isInteger(raw.imageCount) && raw.imageCount >= 0 ? raw.imageCount : images.length,
    hasResult: raw.hasResult === true,
    thumbnail: text(raw.thumbnail),
    cover: text(raw.cover),
    images,
  })
}
// ----- End of Functions ----------------------------------------------------- //
