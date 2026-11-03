/*!************************************************************************
\file sampleJobs.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
API layer: the read-only routes for sample jobs (JOB_SOURCES includes
'sample', see adapters/jobSources/sample.js). Mounted before routes/jobs.js;
a request for any other job id goes on to it. Sample jobs can be listed,
polled, viewed and downloaded by any signed-in user, never changed: a
rename or delete reaches routes/jobs.js, which finds no such job (404).
- GET /jobs/:id, GET /jobs/:id/images/:name, GET /jobs/:id/result.ply,
  GET /jobs/:id/cover.webp
The same replies as for a real job.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import path from 'node:path'
import express from 'express'
import { config } from '../config.js'
import { requireUser } from '../middleware/session.js'
import { findSampleJob } from '../adapters/jobSources/sample.js'

const router = express.Router()

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Middleware: sets req.sample when sample jobs are on and the id is one;
    otherwise leaves this router so routes/jobs.js handles the request.
*/
/************************************************************************/
function onlySampleJobs(req, _res, next)
{
  req.sample = config.jobSources.includes('sample') ? findSampleJob(req.params.id) : null
  next(req.sample ? undefined : 'route')
}

// ----- Start of Routes ------------------------------------------------------ //

/************************************************************************/
/*!
  \brief
    A sample job's status, in the same shape as a real job's.
  \return
    401 if not signed in, else the status
*/
/************************************************************************/
router.get('/jobs/:id', onlySampleJobs, requireUser, (req, res) =>
{
  const { sample } = req
  res.json({
    id: sample.id,
    status: sample.status,
    phase: sample.status === 'done' ? 'done' : null,
    progress: sample.status === 'done' ? 1 : 0,
    detail: null,
    error: null,
    updatedAt: sample.createdAt,
    imageCount: sample.photos.length,
    removeBackground: false,
    hasResult: sample.status === 'done' && Boolean(sample.modelPath),
    logTail: [],
  })
})

/************************************************************************/
/*!
  \brief
    One of a sample job's photos (only names listed in its sample entry).
  \return
    401 if not signed in, 404 if it isn't one of its photos, else the image
*/
/************************************************************************/
router.get('/jobs/:id/images/:name', onlySampleJobs, requireUser, (req, res) =>
{
  const { sample } = req
  if (!sample.photosPath || !sample.photos.includes(req.params.name))
    return res.status(404).json({ error: 'image not found' })
  res.sendFile(path.join(sample.photosPath, req.params.name), (err) =>
  {
    if (err && !res.headersSent) res.status(404).json({ error: 'image not found' })
  })
})

/************************************************************************/
/*!
  \brief
    A sample job's model (byte ranges work, as for a real job).
  \return
    401 if not signed in, 404 if it has no model, else the .ply
*/
/************************************************************************/
router.get('/jobs/:id/result.ply', onlySampleJobs, requireUser, (req, res) =>
{
  const { sample } = req
  if (sample.status !== 'done' || !sample.modelPath) return res.status(404).json({ error: 'result not ready' })
  res.setHeader('Content-Type', 'application/octet-stream')
  res.sendFile(sample.modelPath, (err) =>
  {
    if (err && !res.headersSent) res.status(404).json({ error: 'result not ready' })
  })
})

/************************************************************************/
/*!
  \brief
    Sample jobs have no cut-out cover; the cards show the first photo.
  \return
    401 if not signed in, else 404
*/
/************************************************************************/
router.get('/jobs/:id/cover.webp', onlySampleJobs, requireUser, (_req, res) =>
{
  res.status(404).json({ error: 'no cover' })
})

export default router
