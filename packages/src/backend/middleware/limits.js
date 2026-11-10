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
Moved out of server.js.
- tooManyAttempts(retryAfterSec)
The message for a rate-limited request.
- limitByIp(limiter)
Middleware factory: per-IP request limits for /auth/login and /auth/signup.
**************************************************************************/

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    The message for a rate-limited request.
  \param retryAfterSec
  number
    Seconds until the limit lifts
  \return
    string
*/
/************************************************************************/
export function tooManyAttempts(retryAfterSec) {
    const minutes = Math.max(1, Math.ceil(retryAfterSec / 60))
    return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
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
        res.set('Retry-After', String(retryAfterSec))
        res.status(429).json({ error: tooManyAttempts(retryAfterSec) })
    }
}
