# `backend/routes/passwordReset.js`

*Author: Gabriel.* API layer for **"Forgot password?"** ([services/passwordReset](../services/passwordReset.md)). Nobody is signed in when using these routes, so they are public and limited per IP. On the VM and in local mode they run on this machine. A team machine passes them to the VM, which holds the accounts and sends the email.

## Limits and messages
- `forgotIpLimiter`: 10 per hour per IP. `resetIpLimiter`: 20 per 15 minutes per IP. The per-email limits and the 5-wrong-codes rule live in the service and do most of the work.
- Messages: `SENT` (*"If an account exists for that email, we've sent it a 6-digit code…"*), `CHANGED`, `WRONG_CODE`, `NOT_SET_UP` (no mail configured), `UNAVAILABLE`.

## Helpers
| Function | Behaviour |
|---|---|
| `readResetBody(body)` | Checks only the shape: a valid email, a non-empty code (trimmed), and a string password. Returns `{ email, code, newPassword }` or `{ error }`. |
| `requestHere(email)` | 503 `NOT_SET_UP` without mail. `limited` gives 429 with `retryAfterSec`. Otherwise **202** with `SENT`. |
| `resetHere(input)` | `weak` gives 400, `invalid` gives 400 `WRONG_CODE`, `ok` gives 200 `{ id, message }`. |
| `askVmForReset(endpoint, body)` | 503 if `clientAuthProblem()` reports a problem. Otherwise `callAuthority`. Setup mistakes (401, or a 503 without an `error`) are logged and become 503. A network error also gives 503. |
| `sendVmReply(res, reply, fallbackError)` | Passes through 200, 202, 400, 429 (with `Retry-After`) and 503. Anything else is logged and answered with 503. |

## Routes

### `POST /auth/forgot-password`
Body `{ email }`. An invalid email gives 400. **Client:** asks the VM, and answers **202 `SENT`** if the VM does (otherwise passes the VM's reply on). **Here:** `requestHere`. The answer is **the same whether or not the account exists**.

### `POST /auth/reset-password`
Body `{ email, code, newPassword }`. **Client:** sends to the VM's `/password-reset/confirm`. On 200, **this machine also ends that user's sessions** (`endOtherSessions(id, null)`), because the VM did the same on its side. **Here:** `resetHere`, returning `{ message: CHANGED }` on success.

### `POST /password-reset/request` *(VM only, `requireAuthorityKey`)*
`/auth/forgot-password` on behalf of a user on a team machine. A 429 also includes `retryAfterSec` in the body.

### `POST /password-reset/confirm` *(VM only)*
`/auth/reset-password` on behalf of a team machine. The reply includes **`id`**, so the team machine can sign that user out of its own sessions too.
