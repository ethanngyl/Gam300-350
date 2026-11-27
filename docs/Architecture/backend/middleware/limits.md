# `backend/middleware/limits.js`

API layer: answers **429** when a rate limit from [ratelimit.js](../catalog-schemas-ratelimit.md) has been used up. Every limit is listed in `docs/architecture.md` under "Rate limits".

## Functions

### `waitText(retryAfterSec)`
How long until the limit lifts, in words. Up to 90 minutes it uses minutes (at least 1); beyond that, hours rounded up. For example `"1 minute"`, `"14 minutes"`, `"3 hours"`.

### `tooManyAttempts(retryAfterSec, what = 'attempts')`
`"Too many <what>. Try again in <waitText>."`

### `send429(res, retryAfterSec, message)`
Sets a `Retry-After` header and replies `429 { error, retryAfterSec }`, the same shape as the password-reset replies.

### `limitByIp(limiter)`
Middleware factory for **per-IP** limits, for example on `/auth/login` and `/auth/signup`. It calls `limiter.hit(req.ip)` and sends a 429 when the limit is passed.

### `limitRequests(limiter)`
The **general API limit** (`RATE_LIMIT_API_PER_MIN`).
- Skips requests that carry the shared key (`hasAuthorityKey`), because team-machine traffic is many users' traffic, and requests already counted (`req.rateCounted`). The API router is mounted twice, at `/api/v1` and at the legacy paths, so a request could otherwise be counted twice.
- The key is `user:<id>` for a signed-in user, otherwise `ip:<address>`.
- A 429 says *"Too many requests…"*.

### `limitPerUser(limiters, { countWhen, message })`
For expensive routes (builds, downloads), placed after `requireUser` or `requireJobAccess`. **Admins and anonymous requests are exempt.**
- **Before** the route: `check()` every limiter without counting. If any is used up, it answers 429 with the **longest** wait and `message(retryAfterSec)`.
- **After** the reply (`res.on('finish')`): it counts the request in every limiter, **but only if `countWhen(statusCode, req)` is true**, so a rejected upload does not use up the user's builds.
