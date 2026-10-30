/*!************************************************************************
\file library.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 27-10-2026
\brief
The client-machine side of the shared library. Machines with a GPU build
models locally; this file sends each finished job (photos + final model) to
the VM, which stores it for every machine, and passes Library requests for
jobs this machine doesn't have on to the VM. Every request carries the
shared AUTH_API_KEY and the id of the user it is made for; the VM looks the
user (and their role) up in its own database and applies the normal owner /
admin rule. The VM side is in server.js (the /library routes).
- syncJob(record)
Sends one finished job to the VM. Returns true once the VM has stored it.
- syncPendingJobs()
Sends every finished job the VM hasn't got yet, one at a time.
- startLibrarySync()
Runs syncPendingJobs now and every config.syncIntervalMin minutes.
- fetchRemoteJobs(user)
The user's job list from the VM (same shape as GET /jobs), or null.
- proxyToVm(req, res, vmPath)
Forwards a browser request to the VM as the logged-in user and streams the
reply back (status, headers, body), including HTTP Range requests.
- forwardToVm(method, vmPath, user, body)
Sends a small JSON request to the VM as a user. Returns { status, data }.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { config } from './config.js'
import { getJobOwnerId, isJobSynced, markJobSynced } from './db.js'
import { scanJobs } from './scan.js'
import { STATUS_FILE } from './status.js'
import { jobs } from './pipeline.js'

// Uploads of a whole job can take a while on a slow connection.
const SYNC_TIMEOUT_MS = 10 * 60 * 1000
// Listing / small requests should fail fast so the page isn't held up.
const LIST_TIMEOUT_MS = 8000
// For streamed files: how long to wait for the VM to start answering.
const PROXY_HEADERS_TIMEOUT_MS = 15000

let syncRunning = false

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    The headers every request to the VM carries: the shared key, and (for
    requests made for a logged-in user) which user the VM should act as.
  \param user
    req.user, or null
  \return
    object of headers
*/
/************************************************************************/
function vmHeaders(user)
{
  const headers = { 'X-Auth-Key': config.authApiKey }
  if (user) headers['X-Act-As-User'] = String(user.id)
  return headers
}

/************************************************************************/
/*!
  \brief
    Sends one finished job to the VM: its photos, final model, metrics,
    card cover and status record, plus its owner (the VM's user id -- on a client machine
    local ids are the VM's) and this machine's name. Marks it synced once
    the VM confirms. Logs and returns false on any failure, so the next
    sync round tries again.
  \param record
    A job record from scanJobs with status 'done' and a resultPath
  \return
    true if the VM stored it; 'full' if the VM is out of disk space
*/
/************************************************************************/
export async function syncJob(record)
{
  const jobDir = path.join(config.jobsDir, record.id)
  try
  {
    const form = new FormData()
    form.append('ownerId', String(getJobOwnerId(record.id) ?? ''))
    form.append('origin', config.machineName)
    form.append('status', fs.readFileSync(path.join(jobDir, STATUS_FILE), 'utf8'))
    for (const image of record.images)
    {
      form.append('images', await fs.openAsBlob(path.join(jobDir, 'images', image.name)), image.name)
    }
    form.append('result', await fs.openAsBlob(record.resultPath), 'result.ply')
    const metricsPath = path.join(config.jobsDir, `${record.id}_out`, 'metrics.json')
    if (fs.existsSync(metricsPath))
      form.append('metrics', await fs.openAsBlob(metricsPath), 'metrics.json')
    // The card cover (made from the background masks before they were tidied up).
    const coverPath = path.join(config.jobsDir, `${record.id}_out`, 'cover.webp')
    if (fs.existsSync(coverPath))
      form.append('cover', await fs.openAsBlob(coverPath), 'cover.webp')

    const resp = await fetch(`${config.vmAuthUrl}/library/jobs/${record.id}`, {
      method: 'PUT',
      headers: vmHeaders(null),
      body: form,
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    })
    if (resp.ok)
    {
      markJobSynced(record.id)
      console.log(`[backend] library: job ${record.id} synced to the VM`)
      return true
    }
    const data = await resp.json().catch(() => ({}))
    console.error(`[backend] library: VM refused job ${record.id} (${resp.status}): ${data.error ?? 'no details'}`)
    return resp.status === 507 ? 'full' : false
  }
  catch (err)
  {
    console.error(`[backend] library: could not send job ${record.id} to the VM: ${err.message}`)
    return false
  }
}

/************************************************************************/
/*!
  \brief
    Sends every finished job the VM hasn't received yet, one at a time.
    Skips jobs still running in memory. Stops early if the VM reports it
    is out of disk space. Only one round runs at a time.
  \return
    nothing
*/
/************************************************************************/
export async function syncPendingJobs()
{
  if (syncRunning) return
  syncRunning = true
  try
  {
    const records = await scanJobs(config.jobsDir)
    for (const record of records)
    {
      if (record.status !== 'done' || !record.resultPath || isJobSynced(record.id)) continue
      const live = jobs.get(record.id)
      if (live && live.status !== 'done') continue
      if (await syncJob(record) === 'full') break
    }
  }
  catch (err)
  {
    console.error('[backend] library: sync round failed:', err)
  }
  finally
  {
    syncRunning = false
  }
}

/************************************************************************/
/*!
  \brief
    Starts sending finished jobs to the VM: once now (which also sends
    jobs made before the library existed), then every syncIntervalMin
    minutes to retry anything the VM missed (e.g. while it was down).
  \return
    nothing
*/
/************************************************************************/
export function startLibrarySync()
{
  syncPendingJobs()
  const timer = setInterval(syncPendingJobs, config.syncIntervalMin * 60 * 1000)
  timer.unref() // never keeps the process alive on its own
  console.log(`[backend] library: sending finished jobs to ${config.vmAuthUrl} (retry every ${config.syncIntervalMin} min)`)
}

/************************************************************************/
/*!
  \brief
    The user's job list from the VM, in the same shape as GET /jobs (the
    VM applies the owner / admin rule).
  \param user
    req.user
  \return
    array of jobs, or null if the VM couldn't be reached
*/
/************************************************************************/
export async function fetchRemoteJobs(user)
{
  try
  {
    const resp = await fetch(`${config.vmAuthUrl}/library/jobs`, {
      headers: vmHeaders(user),
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    })
    if (!resp.ok)
    {
      console.error(`[backend] library: listing jobs from the VM failed (${resp.status})`)
      return null
    }
    const data = await resp.json()
    return Array.isArray(data) ? data : null
  }
  catch (err)
  {
    console.error(`[backend] library: could not reach the VM to list jobs: ${err.message}`)
    return null
  }
}

/************************************************************************/
/*!
  \brief
    Forwards a browser request to the VM, as the logged-in user, and
    streams the VM's reply back unchanged: status, the headers a browser
    needs (type, length, ranges, caching) and the body. The Range header is
    passed on, because the 3D viewer first asks for only the first 4 KB of
    a .ply. A JSON body (rename) is passed on too. If the browser goes away
    mid-download, the request to the VM is cancelled.
  \param req
    The browser's request (req.user must be set)
  \param res
    The response to the browser
  \param vmPath
    string
    Path on the VM, e.g. /library/jobs/<id>/result.ply
  \return
    nothing; always answers the browser
*/
/************************************************************************/
export async function proxyToVm(req, res, vmPath)
{
  const controller = new AbortController()
  const headersTimer = setTimeout(() => controller.abort(), PROXY_HEADERS_TIMEOUT_MS)
  res.on('close', () => controller.abort())

  const headers = vmHeaders(req.user)
  if (req.headers.range) headers.Range = req.headers.range
  let body
  if (!['GET', 'HEAD'].includes(req.method) && req.body && Object.keys(req.body).length > 0)
  {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(req.body)
  }

  try
  {
    const resp = await fetch(`${config.vmAuthUrl}${vmPath}`, {
      method: req.method,
      headers,
      body,
      signal: controller.signal,
    })
    clearTimeout(headersTimer)

    res.status(resp.status)
    for (const name of ['content-type', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control'])
    {
      const value = resp.headers.get(name)
      if (value) res.setHeader(name, value)
    }
    // fetch undoes any compression, so the original length only fits if there was none.
    const length = resp.headers.get('content-length')
    if (length && !resp.headers.get('content-encoding')) res.setHeader('content-length', length)

    if (!resp.body || req.method === 'HEAD') return res.end()
    Readable.fromWeb(resp.body)
      .on('error', () => res.destroy())
      .pipe(res)
  }
  catch (err)
  {
    clearTimeout(headersTimer)
    if (res.headersSent || res.destroyed) return
    console.error(`[backend] library: VM request ${req.method} ${vmPath} failed: ${err.message}`)
    res.status(503).json({ error: 'The shared library is unavailable. Try again shortly.' })
  }
}

/************************************************************************/
/*!
  \brief
    Sends a small JSON request to the VM as a user and reads the JSON
    reply. Used to keep the VM's copy in step when a synced job is renamed
    or deleted on this machine.
  \param method
    'PATCH' | 'DELETE' | ...
  \param vmPath
    string
  \param user
    req.user
  \param body
    object, optional
  \return
    { status, data } -- status 0 if the VM couldn't be reached
*/
/************************************************************************/
export async function forwardToVm(method, vmPath, user, body)
{
  try
  {
    const headers = vmHeaders(user)
    if (body) headers['Content-Type'] = 'application/json'
    const resp = await fetch(`${config.vmAuthUrl}${vmPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    })
    const data = await resp.json().catch(() => ({}))
    return { status: resp.status, data }
  }
  catch (err)
  {
    console.error(`[backend] library: ${method} ${vmPath} on the VM failed: ${err.message}`)
    return { status: 0, data: {} }
  }
}

// ----- End of Functions ----------------------------------------------------- //
