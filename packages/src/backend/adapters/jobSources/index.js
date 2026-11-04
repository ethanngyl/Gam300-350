/*!************************************************************************
\file index.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Picks the job sources (adapters) this machine lists jobs from, set by
JOB_SOURCES in .env:
  live (default) -- the job folders here (folders.js), plus the VM's
                    shared library on a team machine (vmLibrary.js)
  sample         -- read-only sample jobs (sample.js)
  live,sample    -- both
Each source returns the common JobSummary format (jobSummary.js), so
GET /jobs works the same whichever sources are on.
- listJobs(req)
The jobs the request's user may see, from every source that is on: the
first copy of a job wins (this machine's over the VM's), newest first, with
URLs under the request's API version.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { config } from '../../config.js'
import { urlFor } from '../apiVersions.js'
import * as folders from './folders.js'
import * as vmLibrary from './vmLibrary.js'
import * as sample from './sample.js'

// A bad sample file should stop startup, not the first page load.
if (config.jobSources.includes('sample')) sample.loadSamples()

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    The jobs to list for a request. The VM's own /library/jobs (asked by
    team machines) only lists real jobs from its folders.
  \param req
    The request (req.user is set)
  \return
    Promise of JobSummary[]
*/
/************************************************************************/
export async function listJobs(req)
{
  const forTeamMachine = req.path.startsWith('/library/')
  const lists = []
  if (config.jobSources.includes('live'))
  {
    lists.push(await folders.listJobs(req.user))
    if (!forTeamMachine) lists.push(await vmLibrary.listJobs(req.user))
  }
  if (config.jobSources.includes('sample') && !forTeamMachine) lists.push(sample.listJobs())

  const seen = new Set()
  const merged = []
  for (const job of lists.flat())
  {
    if (seen.has(job.id)) continue
    seen.add(job.id)
    merged.push({
      ...job,
      thumbnail: urlFor(req, job.thumbnail),
      cover: urlFor(req, job.cover),
      images: job.images.map((image) => ({ ...image, url: urlFor(req, image.url) })),
    })
  }
  return merged.sort((a, b) => b.createdAt - a.createdAt)
}
// ----- End of Functions ----------------------------------------------------- //
