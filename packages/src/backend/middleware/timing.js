/*!************************************************************************
\file timing.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 07-11-2026
\brief
API layer: times every API request, from arriving to the last byte sent
(or the browser hanging up), and counts it under its route
(services/performance.js). Mounted first in server.js.
- timeRequests (middleware)
Records "METHOD /route/:pattern" (the same name for /api/v1 and the legacy
paths), counting 5xx replies as errors. The website's own files aren't API
calls and aren't recorded; requests for paths the API doesn't have are all
counted under one name, "(no route)", so made-up URLs can't add names.
- routeName(req)
That name, or null for a request no route answered.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { API_V1_PREFIX } from '../adapters/apiVersions.js'
import { recordTiming } from '../services/performance.js'

export const NO_ROUTE = '(no route)'

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    The route a finished request was answered by, as "METHOD /pattern".
    Routes registered for both a path and its /library twin (a list of
    patterns) give the one that was used.
  \param req
    The request
  \return
    string, or null if no route answered it
*/
/************************************************************************/
export function routeName(req)
{
  if (!req.route) return null
  const patterns = [].concat(req.route.path)
  const path = req.originalUrl.split('?')[0]
  const unversioned = path.startsWith(`${API_V1_PREFIX}/`) ? path.slice(API_V1_PREFIX.length) : path
  const isLibrary = unversioned.startsWith('/library/')
  const pattern = patterns.find((p) => p.startsWith('/library/') === isLibrary) ?? patterns[0]
  return `${req.method} ${pattern}`
}

/************************************************************************/
/*!
  \brief
    Middleware: times the request and records it once it ends.
  \param req
    The request
  \param res
    The response
  \param next
    moving on
*/
/************************************************************************/
export function timeRequests(req, res, next)
{
  const startedAt = process.hrtime.bigint()
  let recorded = false
  const record = () =>
  {
    if (recorded) return
    recorded = true
    const name = routeName(req) ?? (res.statusCode === 404 ? NO_ROUTE : null)
    if (!name) return // the website's own files
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6
    recordTiming('api', name, ms, { error: res.statusCode >= 500 })
  }
  res.once('finish', record)
  res.once('close', record)
  next()
}
// ----- End of Functions ----------------------------------------------------- //
