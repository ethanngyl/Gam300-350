# `backend/routes/auth.js`

API layer: **signing up, signing in and signing out**, including Google sign-in. On the VM and in `local` mode the account lives in this machine's database. A client machine forwards sign-up and login to the VM ([services/authority](../services/authority.md)).

## Limits and cookies
- Per IP: `loginIpLimiter` allows **30 per 15 min**, and `signupIpLimiter` **10 per hour**. The per-email limit is in [services/accounts](../services/accounts.md).
- `genesis_google_state` (path `/auth/google`, which also covers the callback): the OAuth state, kept in the browser that **started** the sign-in, so a callback link made in another browser (for example an attacker's, to log a victim into the attacker's account) is rejected.
- `genesis_google_return` (VM): where to send the browser afterwards, for sign-ins started on a team machine.
- `genesis_google_local` (team machine, path `/api/v1/auth/google`): the team machine's own state for the trip to the VM and back.
- These cookies last 10 minutes. The website understands the errors `google_denied` and `google_failed` (shown as `/?login=…`).

## Routes

### `POST /auth/signup`
Body `{ name, email, password, remember? }`.
- **Authority or local:** `validateSignup` (400 on a problem), then `createUser`, `startSession(res, id, remember === true)`, and **201** with the user. `EMAIL_TAKEN` gives **409**.
- **Client:** if `clientAuthProblem()` reports a problem, **503**. Otherwise `callAuthority('/register')`. On 201: `upsertLocalUser(data)` (mirrors the VM's id), starts a local session, and returns the **mirrored row**, so `memberSince` comes from a real stored date. The user's own mistakes (400, 409, 429) are passed through. Anything else is logged and answered with 503 *"Account service is unavailable."*

### `POST /auth/login`
Body `{ email, password, remember? }`. Non-string fields give 400. **An unknown email and a wrong password get the same answer** (401 *"Incorrect email or password."*), so the endpoint cannot be used to find out which accounts exist.
- **Authority or local:** `checkCredentials`. `locked` gives **429** with `Retry-After`. `ok` starts a session and returns the user.
- **Client:** `callAuthority('/verify-account')`. A valid reply is mirrored and starts a session. `valid: false` gives 401. 429 is passed through. Anything else gives 503.

### `GET /auth/me`
`requireUser`. Returns `userFor(req, publicUser(req.user))`. The frontend uses it to check that a saved session is still valid and to pick up role changes.

### `POST /auth/logout`
Deletes the session, clears the cookie, and returns **204**. Safe to call when already signed out.

### `POST /register` *(authority only, `requireAuthorityKey`)*
Called by a client backend, not by browsers. Validates, `createUser`, and returns **201** `{ id, email, name, role }`, so clients can own jobs by the canonical id. 409 if the email is taken.

### `POST /verify-account` *(authority only)*
`checkCredentials` (sharing the per-email limit with this VM's own `/auth/login`). Returns **200 `{ valid: true, id, email, name, role }`** or **`{ valid: false }`** (the same reply for an unknown email and a wrong password), or 429 when locked.

### `GET /auth/google`
- **Not the authority:** with no VM URL, 503. Otherwise it redirects to `<VM>/auth/google`. If this team machine has a working VM connection, it also creates a local state (saved in the `genesis_google_local` cookie) and adds `return_to=<this site>/api/v1/auth/google/finish` and `return_state`.
- **Authority:** 503 if Google is not set up. Otherwise it creates a random state and saves it in the state cookie. It keeps `return_to` and `return_state` in the return cookie **only if `isAllowedReturnUrl` and `isGoogleState` pass**, and clears any leftover return cookie otherwise, so an earlier unfinished sign-in cannot decide where this one ends. Then it redirects to `googleConsentUrl(state)`.

### `GET /auth/google/callback` *(authority)*
1. Reads, and **immediately clears**, the state and return cookies, so each state works once.
2. Failures go back to wherever the sign-in started (`returnUrl(back, { error })` or `/?login=…`).
3. Google sent `error` gives `google_denied`. A missing code, or a state that does not match (`safeEqual`), gives `google_failed`.
4. `readGoogleSignIn(code)`, then `findOrCreateGoogleUser`. `null` (the email is linked to a different Google account) is logged and fails.
5. **Started on a team machine:** redirects to its finish URL with `code = createHandoffCode(user.id)` and its state. **Otherwise:** `startSession(res, id, true)` and redirects to `/`.

### `GET /auth/google/finish` *(team machine only, otherwise 503)*
Checks the state against the `genesis_google_local` cookie (which it clears; one use only), so a finish link made by someone else **cannot sign this browser in to their account**. It passes on a known `error`, requires a code and a working VM connection, then calls `callAuthority('/redeem-google-code', { code })`. The reply must have an integer id and a string email. Then `upsertLocalUser`, `startSession(..., true)` and a redirect to `/`. A 404 from the VM (expired or used code) is logged.

### `POST /redeem-google-code` *(authority only)*
400 with no code. Otherwise `redeemHandoffCode(code)` then `findUserById`, returning **200 `{ id, email, name, role }`** with the role taken from the VM's database, or 404 *"Unknown or expired code."*

## Helpers
- **`googleCookie(req, path)`**: `{ httpOnly, sameSite: 'lax' (still sent on Google's top-level redirect back), secure: req.secure, path, maxAge: 10 min }`.
- **`isGoogleState(value)`**: a string of at most 64 characters made only of `[A-Za-z0-9_-]`.
- **`readReturnCookie(req)`**: parses `{ to, state }` and **checks both again**. Returns `null` if they are invalid.
- **`returnUrl(back, fields)`**: `back.to` with `state` and the extra fields added as query parameters.
