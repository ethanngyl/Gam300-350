/*!************************************************************************
\file auth.js
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
API layer: signing up, in and out. Moved out of server.js.
- POST /auth/signup, POST /auth/login, GET /auth/me, POST /auth/logout
On the VM and in 'local' mode the account lives in this machine's database;
a client machine forwards signup/login to the VM (services/authority.js).
- POST /register, POST /verify-account
VM only, for client machines (shared key): create an account / check a
password.
- GET /auth/google, GET /auth/google/callback
Google sign-in (services/google.js). The consent and callback run on the
VM; other machines send the browser to the VM's /auth/google.
- GET /auth/google/finish, POST /redeem-google-code
Google sign-in started on a team machine's website ends there: the VM
sends the browser back to the team machine's /auth/google/finish with a
one-time code instead of signing in on the VM's website, and the team
machine's backend redeems the code with the VM (shared key) for the
account, then starts its own session.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import crypto from 'node:crypto'
import express from 'express'
import { config } from '../config.js'
import { createUser, deleteSession, findOrCreateGoogleUser, findUserByEmail, findUserById, upsertLocalUser } from '../db.js'
import { createLimiter } from '../ratelimit.js'
import { SESSION_COOKIE, readCookie, requireAuthorityKey, requireUser, startSession } from '../middleware/session.js'
import { limitByIp, tooManyAttempts } from '../middleware/limits.js'
import { checkCredentials, publicUser, validateSignup } from '../services/accounts.js'
import { callAuthority, clientAuthProblem, logAuthorityFailure } from '../services/authority.js'
import {
    GOOGLE_FINISH_PATH, createHandoffCode, googleConsentUrl, googleSignInReady, isAllowedReturnUrl,
    readGoogleSignIn, redeemHandoffCode, safeEqual,
} from '../services/google.js'
import { API_V1_PREFIX, userFor } from '../adapters/apiVersions.js'

const router = express.Router()

// Slow down password guessing and signup spam, per IP, on every machine (the
// per-email limit is in services/accounts.js).
const loginIpLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 30 })
const signupIpLimiter = createLimiter({ windowMs: 60 * 60 * 1000, max: 10 })

// --- Google sign-in state ----------------------------------------------------
// The OAuth "state" is kept in a short-lived cookie in the browser that
// started the sign-in, so a callback link made in another browser (e.g. an
// attacker's, to log a victim into the attacker's account) is rejected.
// path '/auth/google' also covers '/auth/google/callback'.
const GOOGLE_STATE_COOKIE = 'genesis_google_state'
const GOOGLE_STATE_PATH = '/auth/google'
// On the VM: where to send the browser back to (a team machine's website)
// once Google answers, beside the state cookie. Absent = sign in on the VM.
const GOOGLE_RETURN_COOKIE = 'genesis_google_return'
// On a team machine: its own state for the trip to the VM and back, so a
// finish link made by someone else (with their own code) is refused.
const GOOGLE_LOCAL_COOKIE = 'genesis_google_local'
const GOOGLE_LOCAL_PATH = `${API_V1_PREFIX}/auth/google`
const GOOGLE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000
// The failure reasons the website understands (/?login=...).
const GOOGLE_ERRORS = ['google_denied', 'google_failed']

// ----- Start of Routes ------------------------------------------------------ //

/************************************************************************/
/*!
  \brief
    Create an account and log it in. Body: { name, email, password,
    remember? }. The password is stored only as a salted scrypt hash (see
    db.js). New accounts are always role 'user'. remember: true keeps the
    login after the browser closes (see startSession).
  \return
    400 if input is invalid, 409 if the email is taken, else 201, the
    user, and a session cookie
*/
/************************************************************************/
router.post('/auth/signup', limitByIp(signupIpLimiter), async (req, res, next) => {
    const { remember } = req.body || {}

    // Authority (VM) or local: the account lives in this machine's database.
    if (config.authMode !== 'client') {
        const input = validateSignup(req.body)
        if (input.error) return res.status(400).json({ error: input.error })
        try {
            const user = await createUser(input)
            startSession(res, user.id, remember === true)
            return res.status(201).json(userFor(req, publicUser(user)))
        }
        catch (err) {
            if (err.code === 'EMAIL_TAKEN')
                return res.status(409).json({ error: 'An account with that email already exists.' })
            return next(err)
        }
    }

    // Client: forward to the VM, mirror the returned user, then start a local session.
    const problem = clientAuthProblem()
    if (problem) {
        console.error(`[backend] signup refused -- ${problem}`)
        return res.status(503).json({ error: 'Account service is not configured on this machine.' })
    }
    try {
        const { name, email, password } = req.body || {}
        const { status, data } = await callAuthority('/register', { name, email, password })
        if (status === 201) {
            upsertLocalUser(data)                 // mirror VM id -> local users
            startSession(res, data.id, remember === true)
            // The mirrored row, so memberSince comes from a real stored date.
            return res.status(201).json(userFor(req, publicUser(findUserByEmail(data.email))))
        }
        // The user's own mistakes (bad input, email taken, too many tries) pass through.
        if (status === 400 || status === 409 || status === 429)
            return res.status(status).json({ error: data.error || 'Signup failed.' })
        logAuthorityFailure('/register', status, data)
        res.status(503).json({ error: 'Account service is unavailable. Try again shortly.' })
    }
    catch (err) {
        console.error('[backend] account authority call failed:', err)
        res.status(503).json({ error: 'Account service is unavailable. Try again shortly.' })
    }
})

/************************************************************************/
/*!
  \brief
    Sign in. Body: { email, password, remember? }. Unknown email and wrong
    password get the same answer so the endpoint can't be used to probe
    accounts. remember: true keeps the login after the browser closes.
  \return
    401 if the credentials don't match, else 200, the user, and a session
    cookie
*/
/************************************************************************/
router.post('/auth/login', limitByIp(loginIpLimiter), async (req, res, next) => {
    const { email, password, remember } = req.body || {}
    if (typeof email !== 'string' || typeof password !== 'string')
        return res.status(400).json({ error: 'Enter your email and password.' })

    // Authority (VM) or local: check this machine's database.
    if (config.authMode !== 'client') {
        try {
            const result = await checkCredentials(email, password)
            if (result.status === 'locked') {
                res.set('Retry-After', String(result.retryAfterSec))
                return res.status(429).json({ error: tooManyAttempts(result.retryAfterSec) })
            }
            if (result.status === 'invalid')
                return res.status(401).json({ error: 'Incorrect email or password.' })
            startSession(res, result.user.id, remember === true)
            return res.json(userFor(req, publicUser(result.user)))
        }
        catch (err) { return next(err) }
    }

    // Client: verify against the VM, mirror the user, start a local session.
    const problem = clientAuthProblem()
    if (problem) {
        console.error(`[backend] login refused -- ${problem}`)
        return res.status(503).json({ error: 'Account service is not configured on this machine.' })
    }
    try {
        const { status, data } = await callAuthority('/verify-account', { email, password })
        if (status === 200 && data.valid) {
            upsertLocalUser(data)
            startSession(res, data.id, remember === true)
            // The mirrored row, so memberSince comes from a real stored date.
            return res.json(userFor(req, publicUser(findUserByEmail(data.email))))
        }
        if (status === 200)
            return res.status(401).json({ error: 'Incorrect email or password.' })
        if (status === 429)
            return res.status(429).json({ error: data.error || tooManyAttempts(0) })
        logAuthorityFailure('/verify-account', status, data)
        res.status(503).json({ error: 'Account service is unavailable. Try again shortly.' })
    }
    catch (err) {
        console.error('[backend] account authority call failed:', err)
        res.status(503).json({ error: 'Account service is unavailable. Try again shortly.' })
    }
})

/************************************************************************/
/*!
  \brief
    Who is logged in, according to the session cookie. Lets the frontend
    check a saved session is still valid (and pick up role changes).
  \return
    401 if not logged in, else the user
*/
/************************************************************************/
router.get('/auth/me', requireUser, (req, res) => {
    res.json(userFor(req, publicUser(req.user)))
})

/************************************************************************/
/*!
  \brief
    Log out: deletes the session and clears the cookie. Safe to call when
    already logged out.
  \return
    204
*/
/************************************************************************/
router.post('/auth/logout', (req, res) => {
    deleteSession(readCookie(req, SESSION_COOKIE))
    res.clearCookie(SESSION_COOKIE, { path: '/' })
    res.status(204).end()
})

/************************************************************************/
/*!
  \brief
    Authority-only: create an account in the VM's database. Called by a
    client backend's /auth/signup, not by browsers. Returns the new user's
    canonical id so clients can own jobs by it.
  \return
    400 invalid input, 409 email taken, 201 { id, email, name, role }
*/
/************************************************************************/

router.post('/register', requireAuthorityKey, async (req, res, next) => {
    const input = validateSignup(req.body)
    if (input.error) return res.status(400).json({ error: input.error })
    try {
        const user = await createUser(input)
        res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role })
    }
    catch (err) {
        if (err.code === 'EMAIL_TAKEN')
            return res.status(409).json({ error: 'An account with that email already exists.' })
        next(err)
    }
})


/************************************************************************/
/*!
  \brief
    Authority-only: check credentials against the VM's database. Unknown
    email and wrong password return the same { valid: false } so the
    endpoint can't be used to probe which emails are registered. Shares
    the per-email failure limit with this VM's own /auth/login.
  \return
    200 { valid: true, id, email, name, role } or { valid: false },
    429 when that email has had too many wrong passwords
*/
/************************************************************************/

router.post('/verify-account', requireAuthorityKey, async (req, res, next) => {
    const { email, password } = req.body || {}
    if (typeof email !== 'string' || typeof password !== 'string')
        return res.status(400).json({ error: 'Email and password required.' })
    try {
        const result = await checkCredentials(email, password)
        if (result.status === 'locked')
            return res.status(429).json({ error: tooManyAttempts(result.retryAfterSec) })
        if (result.status === 'invalid')
            return res.json({ valid: false })
        const { user } = result
        res.json({ valid: true, id: user.id, email: user.email, name: user.name, role: user.role })
    }
    catch (err) {
        next(err)
    }
})

/************************************************************************/
/*!
  \brief
    Start Google sign-in: redirect the browser to Google's consent screen.
    On the VM only -- the redirect URI is registered against it. Other
    machines send the browser to the VM's /auth/google (VM_AUTH_URL), so
    the website's button can use this same relative link everywhere.
    A random state goes both to Google and into a 10-minute HttpOnly
    cookie in this browser; the callback requires the two to match.
    A team machine with a working VM connection also asks the VM to send
    the browser back to its own website afterwards (?return_to, with its
    own state in ?return_state and in a cookie here). The VM keeps an
    allowed return_to in a second cookie for the callback; any other
    return_to is ignored, and the sign-in ends on the VM's website.
  \return
    302 to Google (or to the VM), or 503 if Google sign-in isn't set up
*/
/************************************************************************/
router.get('/auth/google', (req, res) => {
    if (config.authMode !== 'authority') {
        if (!config.vmAuthUrl) return res.status(503).json({ error: 'Google sign-in is not available here.' })
        const vmStart = new URL(`${config.vmAuthUrl}/auth/google`)
        // Without a working VM connection the code couldn't be redeemed, so
        // the sign-in ends on the VM's website as before.
        if (config.authMode === 'client' && !clientAuthProblem()) {
            const localState = crypto.randomBytes(16).toString('base64url')
            res.cookie(GOOGLE_LOCAL_COOKIE, localState, googleCookie(req, GOOGLE_LOCAL_PATH))
            // This website's own address, as the browser reached it (e.g.
            // http://localhost:5005, or :5173 through Vite in development).
            vmStart.searchParams.set('return_to', `${req.protocol}://${req.get('host')}${GOOGLE_FINISH_PATH}`)
            vmStart.searchParams.set('return_state', localState)
        }
        return res.redirect(vmStart.href)
    }
    if (!googleSignInReady())
        return res.status(503).json({ error: 'Google sign-in is not available here.' })

    const state = crypto.randomBytes(16).toString('base64url')
    // sameSite 'lax' is still sent on Google's redirect back, because that
    // is a normal top-level navigation.
    res.cookie(GOOGLE_STATE_COOKIE, state, googleCookie(req, GOOGLE_STATE_PATH))
    const { return_to: returnTo, return_state: returnState } = req.query
    if (isAllowedReturnUrl(returnTo) && isGoogleState(returnState))
        res.cookie(GOOGLE_RETURN_COOKIE, JSON.stringify({ to: returnTo, state: returnState }), googleCookie(req, GOOGLE_STATE_PATH))
    else
        // An earlier, unfinished sign-in from a team machine mustn't decide where this one ends.
        res.clearCookie(GOOGLE_RETURN_COOKIE, { path: GOOGLE_STATE_PATH })
    res.redirect(googleConsentUrl(state))
})

/************************************************************************/
/*!
  \brief
    Google redirects back here with ?code & ?state. Verify state against
    this browser's state cookie (one use only: the cookie is cleared
    straight away), exchange the code for the verified email/name/sub
    (readGoogleSignIn), find-or-create the account, then either:
    - start a session and go to the app (sign-in started on the VM), or
    - send the browser back to the team machine it started on with a
      one-time code and that machine's state, without a VM session.
    Failures also go back where the sign-in started.
  \return
    302 to "/" on success (logged in), 302 to "/?login=..." on failure,
    302 to the team machine's /auth/google/finish (?code or ?error, and
    ?state), 503 if Google sign-in isn't set up here
*/
/************************************************************************/
router.get('/auth/google/callback', async (req, res) => {
    if (!googleSignInReady()) return res.status(503).json({ error: 'Google sign-in is not available here.' })
    const { code, state, error } = req.query

    const expectedState = readCookie(req, GOOGLE_STATE_COOKIE)
    const back = readReturnCookie(req)
    res.clearCookie(GOOGLE_STATE_COOKIE, { path: GOOGLE_STATE_PATH })
    res.clearCookie(GOOGLE_RETURN_COOKIE, { path: GOOGLE_STATE_PATH })
    const fail = (reason) => res.redirect(back ? returnUrl(back, { error: reason }) : `/?login=${reason}`)

    if (error) return fail('google_denied')
    if (!code || !safeEqual(state, expectedState)) return fail('google_failed')

    try {
        const profile = await readGoogleSignIn(code)
        if (!profile) return fail('google_failed')

        // Find or create the account, link by email.
        const user = findOrCreateGoogleUser(profile)
        if (!user) {
            console.warn(`[backend] google sign-in refused: ${profile.email} is already linked to a different Google account`)
            return fail('google_failed')
        }
        // Started on a team machine: its backend redeems the code for the
        // account and starts its own session there.
        if (back) return res.redirect(returnUrl(back, { code: createHandoffCode(user.id) }))
        startSession(res, user.id, true)
        res.redirect('/')
    }
    catch (err) {
        console.error('[backend] google callback failed:', err)
        fail('google_failed')
    }
})

/************************************************************************/
/*!
  \brief
    Team machine: the browser back from the VM after Google sign-in. The
    state must match this browser's cookie (one use only), so a finish link
    someone else made can't sign this browser in to their account. The
    one-time code is redeemed with the VM (shared key); the account is
    copied here, as after a password login, and a session starts.
  \return
    302 to "/" (signed in) or "/?login=google_failed|google_denied", or 503
    if this machine isn't a team machine
*/
/************************************************************************/
router.get('/auth/google/finish', async (req, res) => {
    if (config.authMode !== 'client')
        return res.status(503).json({ error: 'Google sign-in is not available here.' })
    const { code, state, error } = req.query

    const expectedState = readCookie(req, GOOGLE_LOCAL_COOKIE)
    res.clearCookie(GOOGLE_LOCAL_COOKIE, { path: GOOGLE_LOCAL_PATH })
    const fail = (reason) => res.redirect(`/?login=${reason}`)

    if (!safeEqual(state, expectedState)) return fail('google_failed')
    if (error) return fail(GOOGLE_ERRORS.includes(error) ? error : 'google_failed')
    if (typeof code !== 'string' || !code) return fail('google_failed')
    const problem = clientAuthProblem()
    if (problem) {
        console.error(`[backend] google sign-in refused -- ${problem}`)
        return fail('google_failed')
    }

    try {
        const { status, data } = await callAuthority('/redeem-google-code', { code })
        if (status !== 200 || !Number.isInteger(data.id) || typeof data.email !== 'string') {
            if (status === 404)
                console.warn('[backend] google sign-in: the VM refused the one-time code (expired or already used)')
            else
                logAuthorityFailure('/redeem-google-code', status, data)
            return fail('google_failed')
        }
        upsertLocalUser(data)                 // mirror VM id -> local users
        startSession(res, data.id, true)
        res.redirect('/')
    }
    catch (err) {
        console.error('[backend] google sign-in: could not reach the VM:', err)
        fail('google_failed')
    }
})

/************************************************************************/
/*!
  \brief
    Authority-only: a team machine's backend trades the one-time code from
    a Google sign-in (GET /auth/google/callback) for the account. Each code
    works once, for config.googleHandoffTtlSec seconds. The role comes from
    the VM's database, as with /verify-account.
  \return
    400 without a code, 404 for an unknown, used or expired code, else
    200 { id, email, name, role }
*/
/************************************************************************/
router.post('/redeem-google-code', requireAuthorityKey, (req, res) => {
    const { code } = req.body || {}
    if (typeof code !== 'string' || !code) return res.status(400).json({ error: 'code required.' })
    const userId = redeemHandoffCode(code)
    const user = userId === null ? null : findUserById(userId)
    if (!user) return res.status(404).json({ error: 'Unknown or expired code.' })
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role })
})

// ----- Helpers ------------------------------------------------------------ //

// The short-lived HttpOnly cookie options for a step of Google sign-in.
function googleCookie(req, cookiePath) {
    return { httpOnly: true, sameSite: 'lax', secure: req.secure, path: cookiePath, maxAge: GOOGLE_COOKIE_MAX_AGE_MS }
}

// A state this code made (16 random bytes, base64url), or close enough to
// be safe to carry: letters, digits, - and _ only.
function isGoogleState(value) {
    return typeof value === 'string' && /^[\w-]{16,128}$/.test(value)
}

// The VM's return cookie: { to, state }, checked again, or null.
function readReturnCookie(req) {
    try {
        const back = JSON.parse(readCookie(req, GOOGLE_RETURN_COOKIE) ?? 'null')
        return back && isAllowedReturnUrl(back.to) && isGoogleState(back.state) ? back : null
    }
    catch {
        return null
    }
}

// The team machine's finish address with its state and the given fields.
function returnUrl(back, fields) {
    const url = new URL(back.to)
    url.searchParams.set('state', back.state)
    for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value)
    return url.href
}

export default router
