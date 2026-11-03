/*!************************************************************************
\file vmLibrary.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Job source: the VM's shared library, on a team machine (AUTH_MODE=client).
The VM's reply is outside data -- possibly from an older build -- so every
item is checked and converted into a JobSummary (normalizeJobSummary), and
items that aren't usable jobs are dropped instead of reaching the browser.
- listJobs(user)
The user's jobs in the VM's library, or [] when this machine has no
working VM connection or the VM can't be reached.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { config } from '../../config.js'
import { fetchRemoteJobs } from '../../library.js'
import { clientAuthProblem } from '../../services/authority.js'
import { normalizeJobSummary } from './jobSummary.js'

export const name = 'vmLibrary'

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    The user's jobs from the VM (the VM applies the owner / admin rule).
  \param user
    req.user
  \return
    Promise of JobSummary[]
*/
/************************************************************************/
export async function listJobs(user)
{
  if (config.authMode !== 'client' || clientAuthProblem()) return []
  const remote = await fetchRemoteJobs(user)
  if (!remote) return []
  const summaries = remote.map(normalizeJobSummary).filter(Boolean)
  if (summaries.length < remote.length)
    console.warn(`[backend] library: ignored ${remote.length - summaries.length} job(s) from the VM that weren't valid`)
  return summaries
}
// ----- End of Functions ----------------------------------------------------- //
