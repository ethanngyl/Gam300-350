/*!************************************************************************
\file sample.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Job source: read-only sample jobs, listed when JOB_SOURCES includes
'sample'. They are described in sample-data/jobs.json (format:
schemas/sample-jobs.schema.json) and use files already in the repository:
the engine's sample models and the Sample Image Set photos. Useful for
working on the website without a GPU or the VM, and to show that the job
source can change without touching the routes or the frontend.
- loadSamples()
Reads and checks sample-data/jobs.json once (throws on a bad file).
- listJobs()
Every sample job as a JobSummary.
- findSampleJob(id)
One sample job with its files' full paths, or null.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../../config.js'
import { validate } from '../../schemas.js'
import { makeJobSummary } from './jobSummary.js'

export const name = 'sample'

let samples = null

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Reads the sample jobs file and resolves its paths (relative to the
    repository root).
  \return
    Map of id -> { id, name, status, createdAt, photos, photosPath,
    modelPath }. Throws an Error naming the problems with the file.
*/
/************************************************************************/
export function loadSamples()
{
  if (samples) return samples
  const file = config.sampleDataFile
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const problems = validate('sample-jobs', data)
  if (problems.length > 0) throw new Error(`sample jobs ${file} are not valid:\n  ${problems.join('\n  ')}`)

  samples = new Map(data.jobs.map((job) => [job.id, {
    ...job,
    photosPath: job.photosDir ? path.join(config.repoRoot, job.photosDir) : null,
    modelPath: job.model ? path.join(config.repoRoot, job.model) : null,
  }]))
  return samples
}

/************************************************************************/
/*!
  \brief
    One sample job, if the id is one.
  \param id
    string
  \return
    The sample (see loadSamples), or null
*/
/************************************************************************/
export function findSampleJob(id)
{
  return loadSamples().get(id) ?? null
}

/************************************************************************/
/*!
  \brief
    Every sample job in the common format. A sample has a result when its
    model file is there (the repo's sample models can be missing).
  \return
    JobSummary[]
*/
/************************************************************************/
export function listJobs()
{
  return [...loadSamples().values()].map((sample) =>
  {
    const images = sample.photos.map((photo) => ({ name: photo, url: `/jobs/${sample.id}/images/${photo}` }))
    const hasResult = sample.status === 'done' && Boolean(sample.modelPath) && fs.existsSync(sample.modelPath)
    return makeJobSummary({
      id: sample.id,
      name: sample.name,
      status: sample.status,
      phase: sample.status === 'done' ? 'done' : null,
      progress: sample.status === 'done' ? 1 : 0,
      createdAt: sample.createdAt,
      updatedAt: sample.createdAt,
      imageCount: images.length,
      hasResult,
      thumbnail: images[0]?.url ?? null,
      cover: null,
      images,
    })
  })
}
// ----- End of Functions ----------------------------------------------------- //
