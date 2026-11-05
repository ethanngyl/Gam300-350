/*!************************************************************************
\file session.js
\author1 Gabriel Sebastian Putra
\author2 Xiong Yang
\author3 Ethan Ng
\par DP email1: gabrielsebastian.p@digipen.edu
\par DP email2: xiong.yang@digipen.edu
\par DP email3: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
API layer: who is calling and what they may reach. Moved out of server.js.
- SESSION_COOKIE / readCookie(req, name) / startSession(res, userId, remember)
Read a cookie from the request / log a user in by setting the HttpOnly
session cookie (the session itself is stored in db.js). With "Remember me"
the cookie lasts 7 days; without it the browser drops it on close.
- loadUser / requireUser / requireAdmin (middleware)
loadUser sets req.user from the session cookie on every request;
requireUser answers 401 when nobody is logged in, requireAdmin 403 when
the user isn't an admin.
- canAccessJob(user, jobId) / requireJobAccess (middleware)
Role check: admins can access every job, users only jobs they created.
requireJobAccess guards the /jobs/:id routes and answers 404 for someone
else's job.
- isRemoteJob(id) / actAsUser (middleware)
Shared library. On a client machine, a job id with no folder here is in the
VM's library, so the /jobs routes pass the request to the VM (library.js).
On the VM, the same routes also answer under /library/... for client
machines (shared key required), acting as the user they name -- with the
role from the VM's own database.
- requireAuthorityKey (middleware)
On the VM, guards /register, /verify-account and /library/... with the
shared AUTH_API_KEY.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from '../config.js'
import { SESSION_TTL_MS, SHORT_SESSION_TTL_MS, createSession, findSessionUser, findUserById, getJobOwnerId } from '../db.js'
import { JOB_ID_RE } from '../scan.js'
import { clientAuthProblem } from '../services/authority.js'

// ----- Start of Functions --------------------------------------------------- //

// --- Accounts and access ----------------------------------------------------
export const SESSION_COOKIE = 'genesis_session'

/************************************************************************/
/*!
  \brief
    Reads one cookie from the request's Cookie header (Express doesn't
    parse cookies without the cookie-parser package).
  \param req
    The request from the user
  \param name
  string
    The cookie's name
  \return
    The cookie's value, or null if it isn't set
*/
/************************************************************************/
export function readCookie(req, name) {
    for (const part of (req.headers.cookie ?? '').split(';')) {
        const eq = part.indexOf('=')
        if (eq !== -1 && part.slice(0, eq).trim() === name) {
            try {
                return decodeURIComponent(part.slice(eq + 1).trim())
            }
            catch
            {
                return null
            }
        }
    }
    return null
}

/************************************************************************/
/*!
  \brief
    Starts a session for a user and sends it to the browser as an
    HttpOnly cookie (page scripts can't read it). The browser then sends
    it with every request to this server, including <img> loads.
  \param res
    The response from the backend
  \param userId
  number
    The user's id
  \param remember
  bool
    true ("Remember me" ticked): the cookie lasts SESSION_TTL_MS (7 days).
    false: no maxAge, so it is a browser-session cookie that is dropped
    when the browser closes; the server also expires it after
    SHORT_SESSION_TTL_MS in case the browser stays open or restores it.
*/
/************************************************************************/
export function startSession(res, userId, remember) {
    // secure: over HTTPS (e.g. behind Caddy) the browser never sends the
    // cookie over plain HTTP. Stays off for http://localhost development.
    const options = { httpOnly: true, sameSite: 'lax', path: '/', secure: res.req.secure }
    if (remember) options.maxAge = SESSION_TTL_MS
    res.cookie(SESSION_COOKIE, createSession(userId, remember ? SESSION_TTL_MS : SHORT_SESSION_TTL_MS), options)
}

/************************************************************************/
/*!
  \brief
    Middleware: sets req.user to the logged-in user ({ id, email, name,
    role, createdAt }) or null. Never rejects; requireUser does that.
  \param req
    The request from the user
  \param _res
    The response from the backend
  \param next
    moving on
*/
/************************************************************************/
export function loadUser(req, _res, next) {
    req.user = findSessionUser(readCookie(req, SESSION_COOKIE))
    next()
}

/************************************************************************/
/*!
  \brief
    Middleware: rejects the request unless someone is logged in.
  \return
    401 if not logged in
*/
/************************************************************************/
export function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Please sign in first.' })
    next()
}

/************************************************************************/
/*!
  \brief
    Middleware (after requireUser): rejects the request unless the user
    is an admin. The role comes from the database on every request, so a
    promotion or demotion counts straight away.
  \return
    403 if not an admin
*/
/************************************************************************/
export function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can do this.' })
    next()
}

/************************************************************************/
/*!
  \brief
    Whether a user may see / use a job: admins can access every job,
    other users only the jobs they created. A job with no recorded owner
    (made before accounts existed) is admin-only.
  \param user
    req.user
  \param jobId
  string
    The job's id
  \return
    bool
*/
/************************************************************************/
export function canAccessJob(user, jobId) {
    if (!user) return false
    if (user.role === 'admin') return true
    return getJobOwnerId(jobId) === user.id
}

/************************************************************************/
/*!
  \brief
    Middleware for /jobs/:id routes: login required, and the job must be
    accessible to the caller. Someone else's job answers 404, not 403, so
    it can't be used to find out which job ids exist.
  \return
    401 if not logged in, 404 if the job isn't theirs
*/
/************************************************************************/
export function requireJobAccess(req, res, next)
{
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' })
  // On a client machine, a job that isn't here may be in the VM's shared
  // library: the route passes the request on, and the VM applies the same
  // owner / admin rule (see isRemoteJob).
  if (isRemoteJob(req.params.id))
  {
    req.remoteJob = true
    return next()
  }
  if (!canAccessJob(req.user, req.params.id)) return res.status(404).json({ error: 'job not found' })
  next()
}

/************************************************************************/
/*!
  \brief
    On a client machine with a working VM connection: true when a job id
    has no folder here, so the job can only be in the VM's shared library.
    Always false on the VM and in local mode.
  \param id
  string
    The job id from the URL
  \return
    bool
*/
/************************************************************************/
export function isRemoteJob(id)
{
  return config.authMode === 'client' && !clientAuthProblem() &&
    JOB_ID_RE.test(id) && !fs.existsSync(path.join(config.jobsDir, id))
}

/************************************************************************/
/*!
  \brief
    Middleware for the VM's /library routes (after requireAuthorityKey):
    sets req.user to the user named in the X-Act-As-User header, looked up
    in the VM's own database -- so the role comes from the VM, never from
    the client machine. No header (e.g. storing a job) means no user.
  \param req
    The request from the client machine
  \param _res
    The response
  \param next
    moving on
*/
/************************************************************************/
export function actAsUser(req, _res, next)
{
  const raw = req.get('X-Act-As-User')
  const id = Number(raw)
  req.user = raw && Number.isInteger(id) ? findUserById(id) : null
  next()
}

/************************************************************************/
/*!
  \brief
    Middleware for the authority-only account API (/register,
    /verify-account). Rejects any request without the shared secret in the
    X-Auth-Key header. Only meaningful when this instance is the authority.
  \return
    503 if this instance isn't the authority, 401 on a missing/wrong key
*/
/************************************************************************/

export function requireAuthorityKey(req, res, next) {
    if (config.authMode !== 'authority')
        return res.status(503).json({ error: 'This server is not the account authority.' })
    const key = Buffer.from(req.get('X-Auth-Key') ?? '')
    // constant-time compare so the key can't be guessed by timing. Byte
    // lengths must match first or timingSafeEqual throws.
    const expected = Buffer.from(config.authApiKey)
    if (expected.length === 0 || key.length !== expected.length ||
        !crypto.timingSafeEqual(key, expected))
        return res.status(401).json({ error: 'Unauthorized.' })
    next()
}
