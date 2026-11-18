/*!************************************************************************
\file passwordReset.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-11-2026
\brief
API layer: "Forgot password?" (services/passwordReset.js). Nobody is signed
in for these, so they are public, with per-IP limits.
- POST /auth/forgot-password
Body { email }. Emails a 6-digit code if the email has an account; the
answer is the same either way (202).
- POST /auth/reset-password
Body { email, code, newPassword }. Sets the new password and signs the
account out everywhere.
On the VM and in local mode these run here. A team machine passes them to
the VM, which holds the accounts and sends the email:
- POST /password-reset/request, POST /password-reset/confirm
VM only, for team machines (shared key). After a reset the team machine
also signs that user out of its own sessions.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import express from 'express'
import { config } from '../config.js'
import { endOtherSessions } from '../db.js'
import { createLimiter } from '../ratelimit.js'
import { requireAuthorityKey } from '../middleware/session.js'
import { limitByIp, tooManyAttempts } from '../middleware/limits.js'
import { isValidEmail } from '../services/accounts.js'
import { callAuthority, clientAuthProblem, logAuthorityFailure } from '../services/authority.js'
import { mailReady } from '../services/mail.js'
import { requestReset, resetPassword } from '../services/passwordReset.js'

const router = express.Router()

// Per IP, on every machine (the per-email limits and the 5 wrong codes per
// code are in the service, and do most of the work).
const forgotIpLimiter = createLimiter({ windowMs: 60 * 60 * 1000, max: 10 })
const resetIpLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 20 })

const SENT = 'If an account exists for that email, we\'ve sent it a 6-digit code. It works for 15 minutes.'
const CHANGED = 'Password changed. Sign in with your new password.'
const WRONG_CODE = 'That code is wrong or has expired. Check the email, or ask for a new code.'
const NOT_SET_UP = 'Password reset by email isn\'t set up here. Ask a team admin to reset your password.'
const UNAVAILABLE = 'The account service is unavailable. Try again shortly.'

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    The request body for a reset, checked for shape only.
  \return
    { email, code, newPassword } or { error }
*/
/************************************************************************/
function readResetBody(body) {
    const { email, code, newPassword } = body || {}
    if (!isValidEmail(email)) return { error: 'Enter a valid email address.' }
    if (typeof code !== 'string' || !code.trim()) return { error: 'Enter the 6-digit code from the email.' }
    if (typeof newPassword !== 'string') return { error: 'Enter a new password.' }
    return { email: email.trim(), code: code.trim(), newPassword }
}

/************************************************************************/
/*!
  \brief
    Asking for a code on the machine that holds the accounts.
  \return
    Promise of { status, body, retryAfterSec? }
*/
/************************************************************************/
async function requestHere(email) {
    if (!mailReady()) return { status: 503, body: { error: NOT_SET_UP } }
    const result = await requestReset(email)
    if (result.status === 'limited')
        return { status: 429, body: { error: tooManyAttempts(result.retryAfterSec) }, retryAfterSec: result.retryAfterSec }
    return { status: 202, body: { message: SENT } }
}

/************************************************************************/
/*!
  \brief
    Using a code on the machine that holds the accounts.
  \return
    Promise of { status, body } (body has id on success, for the VM route)
*/
/************************************************************************/
async function resetHere(input) {
    const result = await resetPassword(input)
    if (result.status === 'weak') return { status: 400, body: { error: 'Password must be at least 6 characters.' } }
    if (result.status === 'invalid') return { status: 400, body: { error: WRONG_CODE } }
    return { status: 200, body: { id: result.userId, message: CHANGED } }
}

/************************************************************************/
/*!
  \brief
    Sends a team machine's request on to the VM and returns the VM's
    answer, or 503 if the VM can't be used.
  \return
    Promise of { status, data }
*/
/************************************************************************/
async function askVmForReset(endpoint, body) {
    const problem = clientAuthProblem()
    if (problem) {
        console.error(`[backend] password reset refused -- ${problem}`)
        return { status: 503, data: { error: UNAVAILABLE } }
    }
    try {
        const reply = await callAuthority(endpoint, body)
        if (reply.status === 401 || (reply.status === 503 && !reply.data?.error))
            logAuthorityFailure(endpoint, reply.status, reply.data)
        return reply
    }
    catch (err) {
        console.error('[backend] account authority call failed:', err)
        return { status: 503, data: { error: UNAVAILABLE } }
    }
}

// Passes a VM reply through, with Retry-After on a 429.
function sendVmReply(res, { status, data }, fallbackError) {
    if (status === 429) res.set('Retry-After', String(data?.retryAfterSec ?? 60))
    if ([202, 400, 429, 503].includes(status) || status === 200) return res.status(status).json(data)
    logAuthorityFailure('password reset', status, data)
    res.status(503).json({ error: fallbackError })
}

// ----- Routes --------------------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    "Forgot password?": emails a 6-digit code if the email has an account.
  \return
    202 { message } (the same whether or not the account exists), 400 bad
    email, 429 too many requests, 503 if email isn't set up
*/
/************************************************************************/
router.post('/auth/forgot-password', limitByIp(forgotIpLimiter), async (req, res, next) => {
    const { email } = req.body || {}
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' })
    try {
        if (config.authMode === 'client') {
            const reply = await askVmForReset('/password-reset/request', { email: email.trim() })
            if (reply.status === 202) return res.status(202).json({ message: SENT })
            return sendVmReply(res, reply, UNAVAILABLE)
        }
        const result = await requestHere(email)
        if (result.retryAfterSec) res.set('Retry-After', String(result.retryAfterSec))
        res.status(result.status).json(result.body)
    }
    catch (err) {
        next(err)
    }
})

/************************************************************************/
/*!
  \brief
    Sets a new password with the emailed code, and signs the account out
    everywhere.
  \return
    200 { message }, 400 wrong / expired code or weak password, 429, 503
*/
/************************************************************************/
router.post('/auth/reset-password', limitByIp(resetIpLimiter), async (req, res, next) => {
    const input = readResetBody(req.body)
    if (input.error) return res.status(400).json({ error: input.error })
    try {
        if (config.authMode === 'client') {
            const reply = await askVmForReset('/password-reset/confirm', input)
            if (reply.status === 200) {
                // The VM signed the account out there; do the same here.
                if (Number.isInteger(reply.data?.id)) endOtherSessions(reply.data.id, null)
                return res.json({ message: CHANGED })
            }
            return sendVmReply(res, reply, UNAVAILABLE)
        }
        const result = await resetHere(input)
        res.status(result.status).json(result.status === 200 ? { message: CHANGED } : result.body)
    }
    catch (err) {
        next(err)
    }
})

/************************************************************************/
/*!
  \brief
    VM only, for team machines (shared key): /auth/forgot-password for a
    user on a team machine.
  \return
    202 { message }, 400, 429 { error, retryAfterSec }, 503
*/
/************************************************************************/
router.post('/password-reset/request', requireAuthorityKey, async (req, res, next) => {
    const { email } = req.body || {}
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' })
    try {
        const result = await requestHere(email)
        res.status(result.status).json(result.retryAfterSec ? { ...result.body, retryAfterSec: result.retryAfterSec } : result.body)
    }
    catch (err) {
        next(err)
    }
})

/************************************************************************/
/*!
  \brief
    VM only, for team machines (shared key): /auth/reset-password for a
    user on a team machine. The reply names the account, so the team
    machine can sign it out of its own sessions too.
  \return
    200 { id, message }, 400
*/
/************************************************************************/
router.post('/password-reset/confirm', requireAuthorityKey, async (req, res, next) => {
    const input = readResetBody(req.body)
    if (input.error) return res.status(400).json({ error: input.error })
    try {
        const result = await resetHere(input)
        res.status(result.status).json(result.body)
    }
    catch (err) {
        next(err)
    }
})
// ----- End of Functions ----------------------------------------------------- //

export default router
