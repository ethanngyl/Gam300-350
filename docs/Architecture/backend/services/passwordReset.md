# `backend/services/passwordReset.js`

*Author: Gabriel.* **"Forgot password?"** on the machine that holds the accounts (the VM, or a machine in local mode). The user asks for a code, receives a **6-digit code by email**, and sends it back with a new password. It follows the **OWASP Forgot Password Cheat Sheet**:
- The code is random (`crypto.randomInt`), stored **only as a salted scrypt hash**, works **once**, lasts `RESET_CODE_TTL_MIN` minutes (15), and stops working after `MAX_WRONG_CODES` (5) wrong tries. A new request replaces it.
- **Nothing reveals whether an email has an account.** A request for an unknown email gets the same answer and takes about as long (the hash is still computed, and the email is sent in the background). A reset with an unknown email, a wrong code or an expired code all fail the same way.
- Per-email limits: one request a minute, and 3 an hour.
- A successful reset **signs the account out everywhere**, lifts its wrong-password lockout, and emails the owner that the password was changed.

## Constants
`MAX_WRONG_CODES = 5`. `requestCooldown` (1 per minute) and `requestsPerHour` (3 per hour) are limiters keyed by the lower-cased email. `DUMMY_HASH` is a hash of random text, checked against when there is no real code, so a guess for an unknown email takes as long as one for a real account.

## Functions

### `newCode()` *(private)*
`crypto.randomInt(0, 1_000_000)`, padded to 6 digits with leading zeros.

### `sendInBackground(message)` *(private)*
Calls `sendMail` **without awaiting it**, so the reply takes the same time whether or not the account exists. A failure is logged, never including the code.

### `requestReset(email)` *(exported)*
1. **Checks** both limiters. If either is used up, returns `{ status: 'limited', retryAfterSec }`. Otherwise it **counts** the request in both.
2. **Always** creates a code and hashes it, so the timing is the same either way.
3. With no such user, returns `{ status: 'sent' }`.
4. Otherwise it saves the hash with its expiry (replacing any earlier code and attempt count) and emails *"Your Genesis password reset code: NNNNNN"* with instructions. Returns `{ status: 'sent' }`.

### `resetPassword({ email, code, newPassword })` *(exported)*
1. A password that breaks the rules gives `{ status: 'weak', error }`, with `passwordProblem`'s message (the route returns it as the 400).
2. Looks up the user and the reset. With no reset, an expired one, or one with too many attempts, it deletes any stale code, **runs a dummy `verifyPassword`** so the timing matches, and returns `{ status: 'invalid' }`.
3. The code must match `^\d{6}$` **and** verify against the hash. If not, the attempt is counted; reaching 5 deletes the code. Returns `invalid`.
4. On success: deletes the code, `setUserPassword`, `endOtherSessions(user, null)` (**every** session, including this browser's), `clearLoginFailures`, and an email in the background saying the password was changed. Returns `{ status: 'ok', userId }`.
