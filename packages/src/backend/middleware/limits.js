/*!************************************************************************
\file limits.js
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
API layer: answering 429 when a rate limit (ratelimit.js) is used up.
Moved out of server.js. Every limit is listed in docs/architecture.md
("Rate limits").
- waitText(retryAfterSec)
"1 minute", "14 minutes", "3 hours": how long until a limit lifts.
- tooManyAttempts(retryAfterSec, what)
The message for a rate-limited request.
- send429(res, retryAfterSec, message)
Answers 429 with Retry-After and { error, retryAfterSec }.
- limitByIp(limiter)
Middleware factory: per-IP request limits (/auth/login, /auth/signup ...).
- limitRequests(limiter)
Middleware factory: the general API limit, per signed-in user or else per
address. Calls from team machines with the shared key are not counted.
- limitPerUser(limiters, { countWhen, message })
Middleware factory: per-user limits on expensive routes (builds, model
downloads) that only count requests that succeeded. Admins are exempt.
**************************************************************************/

import { hasAuthorityKey } from './session.js'

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    How long until a limit lifts, in words. Up to 90 minutes in minutes
    (at least 1), longer in hours (rounded up).
  \param retryAfterSec
  number
    Seconds until the limit lifts
  \return
    string, e.g. "1 minute", "14 minutes", "3 hours"
*/
/************************************************************************/
export function waitText(retryAfterSec) {
    const minutes = Math.max(1, Math.ceil(retryAfterSec / 60))
    if (minutes > 90) {
        const hours = Math.ceil(minutes / 60)
        return `${hours} hours`
    }
    return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

/************************************************************************/
/*!
  \brief
    The message for a rate-limited request.
  \param retryAfterSec
  number
    Seconds until the limit lifts
  \param what
  string, optional
    What there were too many of (default "attempts")
  \return
    string, e.g. "Too many attempts. Try again in 14 minutes."
*/
/************************************************************************/
export function tooManyAttempts(retryAfterSec, what = 'attempts') {
    return `Too many ${what}. Try again in ${waitText(retryAfterSec)}.`
}

/************************************************************************/
/*!
  \brief
    Answers 429 Too Many Requests, with a Retry-After header and
    { error, retryAfterSec } (the same shape as the password-reset replies).
  \param res
    The response
  \param retryAfterSec
  number
    Seconds until the limit lifts
  \param message
  string, optional
    The error text (default tooManyAttempts(retryAfterSec))
*/
/************************************************************************/
export function send429(res, retryAfterSec, message = tooManyAttempts(retryAfterSec)) {
    res.set('Retry-After', String(retryAfterSec))
    res.status(429).json({ error: message, retryAfterSec })
}

/************************************************************************/
/*!
  \brief
    Middleware factory: counts each request against the caller's IP and
    answers 429 once the limiter's maximum is passed.
  \param limiter
    A limiter from createLimiter
  \return
    Express middleware
*/
/************************************************************************/
export function limitByIp(limiter) {
    return (req, res, next) => {
        const { allowed, retryAfterSec } = limiter.hit(req.ip)
        if (allowed) return next()
        send429(res, retryAfterSec)
    }
}

/************************************************************************/
/*!
  \brief
    Middleware factory for the general API limit (RATE_LIMIT_API_PER_MIN).
    Counts each API request against the signed-in user (user:<id>), or the
    caller's address (ip:<address>) for guests, and answers 429 once the
    limit is passed. Requests with the shared key (team machines calling
    the VM, e.g. /library syncs) are not counted: they carry many users'
    traffic. Mounted inside the API router, which the server uses twice
    (/api/v1 and the legacy paths); req.rateCounted makes sure a request
    that goes through both is counted once.
  \param limiter
    A limiter from createLimiter
  \return
    Express middleware
*/
/************************************************************************/
export function limitRequests(limiter) {
    return (req, res, next) => {
        if (req.rateCounted || hasAuthorityKey(req)) return next()
        req.rateCounted = true
        const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`
        const { allowed, retryAfterSec } = limiter.hit(key)
        if (allowed) return next()
        send429(res, retryAfterSec, tooManyAttempts(retryAfterSec, 'requests'))
    }
}

/************************************************************************/
/*!
  \brief
    Middleware factory for per-user limits on expensive routes (after
    requireUser or requireJobAccess). Before the route runs it checks every
    limiter without counting, and answers 429 with the longest wait if any
    is used up. Once the reply is sent it counts the request in every
    limiter, but only if countWhen(status) says it succeeded -- so a
    rejected upload doesn't use up the user's builds. Admins are exempt.
  \param limiters
    Array of limiters from createLimiter (e.g. per hour and per day)
  \param countWhen
    function(statusCode, req) -> bool: which replies count
  \param message
    function(retryAfterSec) -> string: the 429 text
  \return
    Express middleware
*/
/************************************************************************/
export function limitPerUser(limiters, { countWhen, message }) {
    return (req, res, next) => {
        if (!req.user || req.user.role === 'admin') return next()
        const key = `user:${req.user.id}`
        const waits = limiters.map((limiter) => limiter.check(key)).filter((result) => !result.allowed)
        if (waits.length > 0) {
            const retryAfterSec = Math.max(...waits.map((result) => result.retryAfterSec))
            return send429(res, retryAfterSec, message(retryAfterSec))
        }
        res.on('finish', () => {
            if (countWhen(res.statusCode, req)) for (const limiter of limiters) limiter.hit(key)
        })
        next()
    }
}

// ----- End of Functions ----------------------------------------------------- //
