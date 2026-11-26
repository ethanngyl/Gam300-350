# `backend/middleware/session.js`

API layer: **who is calling and what they may reach.** The session data itself is stored by [db.js](../db.md).

## `SESSION_COOKIE = 'genesis_session'`
The engine's [BackendClient](../../engine/net/BackendClient.md) sends the same cookie.

## Functions

### `readCookie(req, name)`
Parses the `Cookie` header by hand (Express does not do this without an extra package). Returns the `decodeURIComponent`'d value, or the raw value if decoding fails, or `null` if the cookie is not set.

### `startSession(res, userId, remember)`
Creates a session in the database and sets the cookie with **`httpOnly`** (page scripts cannot read it), `sameSite: 'lax'`, `path: '/'`, and `secure: req.secure` (over HTTPS the browser never sends it over plain HTTP; this stays off for `http://localhost` development).
- `remember = true`: `maxAge` and the server-side expiry are **7 days**.
- `remember = false`: no `maxAge`, so it is a **browser-session** cookie, and the server also expires it after **24 h** in case the browser stays open or restores the cookie.

### `loadUser(req, _res, next)`
Runs on every request. Sets `req.user = findSessionUser(cookie)`, which is `{ id, email, name, role, createdAt }` or `null`. Never rejects anything.

### `requireUser`
**401** *"Please sign in first."* when there is no user.

### `requireAdmin`
Used after `requireUser`. **403** *"Only admins can do this."* when the role is not admin. The role is read from the database on every request, so a promotion or demotion takes effect at once.

### `canAccessJob(user, jobId)`
Admins can access every job. Other users can access only jobs they own (`getJobOwnerId(jobId) === user.id`). **A job with no recorded owner** (made before accounts existed) is **admin-only**.

### `requireJobAccess`
Guards the `/jobs/:id` routes:
- 401 when nobody is signed in;
- if `isRemoteJob(id)`, it sets `req.remoteJob = true` and continues; the route then passes the request to the VM, which applies the same owner/admin rule;
- otherwise, if the user cannot access the job, **404 `job not found`**. It is 404 rather than 403 so it cannot be used to find out which job ids exist.

### `isRemoteJob(id)`
True **only on a client machine with a working VM connection** (`authMode === 'client'` and no `clientAuthProblem()`), for a valid id with **no folder on this machine**. In that case the job can only be in the VM's shared library. Always false on the VM and in local mode.

### `actAsUser`
For the VM's `/library` routes, after `requireAuthorityKey`. Sets `req.user` from the `X-Act-As-User` id **looked up in the VM's own database**, so the role always comes from the VM and never from the client machine. No header (for example when storing a job) means no user.

### `requireAuthorityKey`
**503** *"This server is not the account authority."* if this machine is not the authority. **401** if the shared key is missing or wrong.

### `hasAuthorityKey(req)`
Compares the `X-Auth-Key` header with `config.authApiKey` using **`crypto.timingSafeEqual`**, so the key cannot be guessed by timing (the byte lengths are checked first, because `timingSafeEqual` throws on a length mismatch). Always false when no key is configured.
