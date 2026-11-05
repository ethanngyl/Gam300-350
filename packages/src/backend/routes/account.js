/*!************************************************************************
\file account.js
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
API layer: the account page. Moved out of server.js.
- GET /auth/me/account, PATCH /auth/me, POST /auth/me/password,
  GET / PUT / DELETE /auth/me/avatar, GET /auth/me/storage
Its details (dates, verified email, sign-in methods, photo version),
changing the name and password (other browsers are logged out), the
profile photo, and how much the user's jobs take up. Accounts live on the
VM: client machines pass these to the VM's /library/account... twins
(askVmAccount).
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import express from 'express'
import { config } from '../config.js'
import {
  deleteUserAvatar, endOtherSessions, getAccount, getUserAvatar, listOwnedJobIds, setUserAvatar,
  setUserPassword, updateUserName, upsertLocalUser,
} from '../db.js'
import { jobStoredBytes } from '../cleanup.js'
import { askVm, isForVm, proxyToVm } from '../library.js'
import { createLimiter } from '../ratelimit.js'
import { SESSION_COOKIE, readCookie, requireUser } from '../middleware/session.js'
import { tooManyAttempts } from '../middleware/limits.js'
import { MIN_PASSWORD_LENGTH, accountDetails, checkCredentials } from '../services/accounts.js'
import { getJob } from '../services/jobs.js'
import { accountFor, toV1Account } from '../adapters/apiVersions.js'

const router = express.Router()

// --- Account page ---------------------------------------------------------------
// Accounts live on the VM, so on a client machine every route below asks the
// VM's /library/account... twin (shared key, acting as the user), the same
// way feedback does. The VM and 'local' machines answer from their own
// database. Guests have no session, so they get 401 everywhere.
const MAX_NAME_LENGTH = 80
// Per account: name and photo changes. Wrong current passwords count
// against the login limit instead (checkCredentials).
const accountEditLimiter = createLimiter({ windowMs: 60 * 60 * 1000, max: 30 })
const ACCOUNT_UNAVAILABLE = { error: 'The account service is unavailable. Try again shortly.' }
const AVATAR_TYPES = ['image/jpeg', 'image/png']
// The photo arrives as the raw image bytes (Content-Type image/jpeg or image/png).
const avatarBody = express.raw({ type: AVATAR_TYPES, limit: `${config.maxAvatarKB}kb` })

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Client machine: passes an account request to the VM as the logged-in
    user. When the VM answers with the account, this machine's copy of it
    is updated too, so /auth/me shows the new name straight away.
  \param req
    The browser's request (req.user is set)
  \param method
    'GET' | 'PATCH' | ...
  \param vmPath
    string, e.g. '/library/account'
  \param body
    object or Buffer, optional (see forwardToVm)
  \param contentType
    string, for a Buffer body
  \return
    { status, data } -- 503 if the VM can't be reached. Account details
    come back in the v1 shape (adapters/apiVersions.js), whichever version
    the VM answered in.
*/
/************************************************************************/
async function askVmAccount(req, method, vmPath, body, contentType) {
    const reply = await askVm(req, method, vmPath, { body, contentType, unavailable: ACCOUNT_UNAVAILABLE })
    if (reply.status === 200 && reply.data?.email)
        upsertLocalUser({ id: req.user.id, email: reply.data.email, name: reply.data.name, role: reply.data.role })
    return { status: reply.status, data: toV1Account(reply.data) }
}

/************************************************************************/
/*!
  \brief
    Counts one name or photo change against the account's hourly limit,
    answering 429 when it is used up.
  \param req
    The request (req.user is set)
  \param res
    The response
  \return
    true if the change may go ahead
*/
/************************************************************************/
function allowAccountEdit(req, res) {
    const { allowed, retryAfterSec } = accountEditLimiter.hit(`user:${req.user.id}`)
    if (allowed) return true
    res.set('Retry-After', String(retryAfterSec))
    res.status(429).json({ error: tooManyAttempts(retryAfterSec) })
    return false
}

// ----- Start of Routes ------------------------------------------------------ //

/************************************************************************/
/*!
  \brief
    The account page's details (see accountDetails). Signed-in users only.
  \return
    401 if not logged in, 503 if the VM can't be reached (client
    machine), else the details
*/
/************************************************************************/
router.get(['/auth/me/account', '/library/account'], requireUser, async (req, res) => {
    if (isForVm(req)) {
        const { status, data } = await askVmAccount(req, 'GET', '/library/account')
        return res.status(status).json(accountFor(req, data))
    }
    res.json(accountFor(req, accountDetails(req.user.id)))
})

/************************************************************************/
/*!
  \brief
    Change the account's display name. Body: { name }. Feedback already
    sent keeps the old name (it is copied in when sent).
  \return
    401 if not logged in, 400 if the name is empty or too long, 429 if
    changing too often, 503 if the VM can't be reached (client machine),
    else the account details
*/
/************************************************************************/
router.patch(['/auth/me', '/library/account'], requireUser, async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (!name) return res.status(400).json({ error: 'Enter your name.' })
    if (name.length > MAX_NAME_LENGTH)
        return res.status(400).json({ error: `Keep your name under ${MAX_NAME_LENGTH} characters.` })
    if (!allowAccountEdit(req, res)) return

    if (isForVm(req)) {
        const { status, data } = await askVmAccount(req, 'PATCH', '/library/account', { name })
        return res.status(status).json(accountFor(req, data))
    }
    updateUserName(req.user.id, name)
    res.json(accountFor(req, accountDetails(req.user.id)))
})

/************************************************************************/
/*!
  \brief
    Change the password. Body: { currentPassword, newPassword }. The
    current password is checked like a login (wrong ones count towards the
    same 10-per-15-minutes limit). Afterwards every other browser signed
    in to the account is logged out; this one stays signed in. A change
    made on a client machine logs out the VM's other sessions and this
    machine's; other client machines keep theirs until they expire.
  \return
    401 if not logged in, 400 if a field is missing, the new password is
    too short or the same, or the current one is wrong, 409 if the account
    has no password (Google only), 429 when locked, 503 if the VM can't be
    reached (client machine), else the account details
*/
/************************************************************************/
router.post(['/auth/me/password', '/library/account/password'], requireUser, async (req, res, next) => {
    const { currentPassword, newPassword } = req.body || {}
    if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string')
        return res.status(400).json({ error: 'Enter your current password and a new password.' })
    if (newPassword.length < MIN_PASSWORD_LENGTH)
        return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` })
    if (newPassword === currentPassword)
        return res.status(400).json({ error: 'Choose a new password that is different from your current one.' })

    if (isForVm(req)) {
        const { status, data } = await askVmAccount(req, 'POST', '/library/account/password', { currentPassword, newPassword })
        if (status === 200) endOtherSessions(req.user.id, readCookie(req, SESSION_COOKIE))
        return res.status(status).json(accountFor(req, data))
    }

    try {
        if (!getAccount(req.user.id)?.hasPassword)
            return res.status(409).json({ error: 'This account signs in with Google, so it has no password to change.' })
        const result = await checkCredentials(req.user.email, currentPassword)
        if (result.status === 'locked') {
            res.set('Retry-After', String(result.retryAfterSec))
            return res.status(429).json({ error: tooManyAttempts(result.retryAfterSec) })
        }
        if (result.status === 'invalid')
            return res.status(400).json({ error: 'Your current password is incorrect.' })

        await setUserPassword(req.user.id, newPassword)
        // From a client machine nothing on the VM is the user's own browser, so all go.
        const keep = req.path.startsWith('/library/') ? null : readCookie(req, SESSION_COOKIE)
        const ended = endOtherSessions(req.user.id, keep)
        console.log(`[backend] password changed for ${req.user.email} (${ended} other session(s) signed out)`)
        res.json(accountFor(req, accountDetails(req.user.id)))
    }
    catch (err) {
        next(err)
    }
})

/************************************************************************/
/*!
  \brief
    The signed-in user's profile photo, with an ETag so an unchanged photo
    is answered with 304. On a client machine it comes from the VM.
  \return
    401 if not logged in, 404 if no photo is set, else the image
*/
/************************************************************************/
router.get(['/auth/me/avatar', '/library/account/avatar'], requireUser, (req, res) => {
    if (isForVm(req)) return proxyToVm(req, res, '/library/account/avatar')
    const avatar = getUserAvatar(req.user.id)
    if (!avatar) return res.status(404).json({ error: 'No profile photo.' })
    res.set({
        'Content-Type': avatar.mime,
        // no-cache: the browser keeps it but checks back, so a new photo shows at once.
        'Cache-Control': 'private, no-cache',
        ETag: `"avatar-${req.user.id}-${avatar.updatedAt}"`,
    })
    if (req.fresh) return res.status(304).end()
    res.send(avatar.data)
})

/************************************************************************/
/*!
  \brief
    Set (or replace) the profile photo. The body is the image itself, sent
    with Content-Type image/jpeg or image/png, at most config.maxAvatarKB
    (the website sends a 256 x 256 JPEG). The bytes are checked to really
    be a JPEG or PNG, like uploaded photos.
  \return
    401 if not logged in, 400 if it isn't a real JPEG / PNG, 413 if too
    large, 429 if changing too often, 503 if the VM can't be reached
    (client machine), else the account details
*/
/************************************************************************/
router.put(['/auth/me/avatar', '/library/account/avatar'], requireUser, avatarBody, async (req, res, next) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0)
        return res.status(400).json({ error: 'Send the photo as a JPEG or PNG image.' })
    try {
        const { fileTypeFromBuffer } = await import('file-type')
        const type = await fileTypeFromBuffer(req.body)
        if (!type || !AVATAR_TYPES.includes(type.mime))
            return res.status(400).json({ error: 'Invalid file content -- only real JPEG or PNG images are accepted.' })
        if (!allowAccountEdit(req, res)) return

        if (isForVm(req)) {
            const { status, data } = await askVmAccount(req, 'PUT', '/library/account/avatar', req.body, type.mime)
            return res.status(status).json(accountFor(req, data))
        }
        setUserAvatar(req.user.id, type.mime, req.body)
        res.json(accountFor(req, accountDetails(req.user.id)))
    }
    catch (err) {
        next(err)
    }
})

/************************************************************************/
/*!
  \brief
    Remove the profile photo (safe when there is none).
  \return
    401 if not logged in, 429 if changing too often, 503 if the VM can't
    be reached (client machine), else the account details
*/
/************************************************************************/
router.delete(['/auth/me/avatar', '/library/account/avatar'], requireUser, async (req, res) => {
    if (!allowAccountEdit(req, res)) return
    if (isForVm(req)) {
        const { status, data } = await askVmAccount(req, 'DELETE', '/library/account/avatar')
        return res.status(status).json(accountFor(req, data))
    }
    deleteUserAvatar(req.user.id)
    res.json(accountFor(req, accountDetails(req.user.id)))
})

/************************************************************************/
/*!
  \brief
    How much the signed-in user's own jobs take up (photos, model and the
    job's other files), for the account page's Storage section. On a
    client machine this is the VM's count -- the shared library, where
    every finished job ends up; jobs not sent yet aren't included.
    Admins see their own jobs only.
  \return
    401 if not logged in, 503 if the VM can't be reached (client
    machine), else { usedBytes, models (finished), jobs (all, including
    failed and running) }
*/
/************************************************************************/
router.get(['/auth/me/storage', '/library/account/storage'], requireUser, async (req, res, next) => {
    if (isForVm(req)) {
        const { status, data } = await askVmAccount(req, 'GET', '/library/account/storage')
        return res.status(status).json(accountFor(req, data))
    }
    try {
        let usedBytes = 0
        let models = 0
        let jobCount = 0
        for (const id of listOwnedJobIds(req.user.id)) {
            const job = await getJob(id)
            if (!job) continue // deleted (its ownership row can outlive it)
            jobCount++
            if (job.status === 'done') models++
            usedBytes += await jobStoredBytes(id)
        }
        res.json({ usedBytes, models, jobs: jobCount })
    }
    catch (err) {
        next(err)
    }
})

export default router
