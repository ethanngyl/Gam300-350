# `backend/routes/account.js`

API layer: the **account page**. Accounts live on the VM, so on a **client machine** every route below asks the VM's `/library/account…` version of itself (with the shared key, acting as the user). The VM and local-mode machines answer from their own database. Every route requires sign-in (401 for guests). Each route is registered for both its own path and its `/library` version.

## Constants and helpers
- `MAX_NAME_LENGTH = 80`.
- `accountEditLimiter`: **30 name or photo changes per account per hour**. Wrong current passwords count towards the login limit instead.
- `AVATAR_TYPES = ['image/jpeg', 'image/png']`. `avatarBody = express.raw({ type: AVATAR_TYPES, limit: maxAvatarKB })`: the photo arrives as raw image bytes.
- **`askVmAccount(req, method, vmPath, body, contentType)`**: calls `askVm` with a 503 *"account service is unavailable"* fallback. When the VM answers with the account, it also **updates this machine's copy** (`upsertLocalUser`), so `/auth/me` shows the new name straight away. The reply is converted to the v1 shape.
- **`allowAccountEdit(req, res)`**: counts one change and sends a 429 with `Retry-After` when the limit is used up.

## Routes

| Route | Behaviour |
|---|---|
| `GET /auth/me/account` | `accountFor(req, accountDetails(id))`, see [services/accounts](../services/accounts.md). |
| `PATCH /auth/me` | Body `{ name }`. It is trimmed; empty gives 400, more than 80 characters gives 400. Rate-limited. Calls `updateUserName` and returns the details. Feedback already sent keeps the old name, because the name is copied in when the feedback is sent. |
| `POST /auth/me/password` | Body `{ currentPassword, newPassword }`. 400 for a missing field, a new password that breaks the rules (`passwordProblem`: 8+ characters, an uppercase letter and a special character), or a new password the same as the current one. **Client:** forwarded to the VM; on 200 this machine also ends its other sessions. **Here:** 409 if the account has no password (Google only). The current password is checked with `checkCredentials` (`locked` gives 429, `invalid` gives 400 *"current password is incorrect"*). Then `setUserPassword` and `endOtherSessions(id, keep)`, where `keep` is this browser's session. **For a `/library` call (from a client machine), every VM session ends**, because none of them is the user's own browser. Returns the details. |
| `GET /auth/me/avatar` | Client: `proxyToVm`. Otherwise 404 if there is no photo, or the image with `Cache-Control: private, no-cache` and `ETag "avatar-<id>-<updatedAt>"`, answering **304** when `req.fresh`. |
| `PUT /auth/me/avatar` | The body must be a non-empty Buffer, **checked with `fileTypeFromBuffer`** to be a real JPEG or PNG (400 otherwise; 413 if too large, from the error handler). Rate-limited. Client: forwarded as raw bytes. Otherwise `setUserAvatar`. Returns the details. |
| `DELETE /auth/me/avatar` | Rate-limited. Calls `deleteUserAvatar`, which is safe when there is no photo. |
| `GET /auth/me/storage` | Client: the VM's count, covering the shared library where every finished job ends up. Here: for each owned job id that still exists, adds `jobStoredBytes`, and counts the jobs and the finished models. Returns `{ usedBytes, models, jobs }`. Admins see only their own jobs here. |
