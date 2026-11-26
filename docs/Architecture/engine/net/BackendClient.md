# `net/BackendClient.h` / `BackendClient.cpp`

The engine's connection to the web app's backend ([backend docs](../../backend/README.md)). It signs in with the **same accounts as the web app**, keeps the session token, lists the caller's reconstruction jobs and downloads finished models into a per-account cache.

The token is sent back as the same **`genesis_session` cookie** the browser uses, so the backend needs no engine-specific routes. Its usual owner-or-admin rules apply: users see only their own models, and admins see every model.

The UI side is [ui/LoginDialog](../ui/LoginDialog.md) and [ui/RemoteModelsPanel](../ui/RemoteModelsPanel.md).

## Data types

### `struct RemoteUser`
`name`, `email`, and `role` (`"user"` or `"admin"`). `isAdmin()` returns true when `role == "admin"`.

### `struct RemoteJob`
`id`, `name` (may be empty), `status` (`queued`/`running`/`done`/`error`/`cancelled`), `error`, `progress` (0…1), `createdAt`, `updatedAt`, `imageCount`, `hasResult`.
- **`displayName()`** returns the user's name, or `"Model <first 8 chars of id>"` if there is none, matching the web app.

## Constants (anonymous namespace)

| Constant | Value |
|---|---|
| `kSessionCookie` | `"genesis_session"`. Must match `SESSION_COOKIE` in `backend/server.js`. |
| `kDefaultServer` | `http://localhost:5005` |
| `kApiPrefix` | `/api/v1`. Must match `API_V1_PREFIX` in `adapters/apiVersions.js`. |
| `kTransferTimeoutMs` | 30 000. A request fails if no data arrives for this long. |
| QSettings keys | `account/server`, `account/email`, `account/session` |

## Internal helpers

- **`NoCookieJar`**: a `QNetworkCookieJar` that never stores or returns cookies. Cookies are attached by hand in `MakeRequest`, so the manager must never resend a session on its own, for example after sign-out.
- **`HttpStatus(reply)`**: the HTTP status code, or 0 if there was no response.
- **`ReplyError(reply, body)`**: a message fit to show the user. It returns a timeout message for status 0 with `OperationCanceledError`, *"Couldn't reach the server (…)"* for other status-0 failures, otherwise the backend's `{ error }` text, and failing that *"HTTP N"*.
- **`ParseUser(json)`**, **`ParseJob(json)`**, and **`ParseTime(value)`**, which reads backend timestamps sent as **milliseconds since the epoch**.
- **`CacheRoot()`**: `AssetPaths::UserDataDir()/remote-models`.

## Public functions

### `BackendClient(QObject* parent)`
Creates the `QNetworkAccessManager`, installs `NoCookieJar`, sets the 30 s transfer timeout and loads the last server URL from QSettings.

### `~BackendClient()`
Disconnects and aborts any sign-in or download that is still running, **without** emitting signals, because the panels listening may already be destroyed. The unfinished `QSaveFile` (a child object) discards its temp file when it is deleted.

### `static QUrl NormalizeServerUrl(const QString&)`
Trims whitespace, removes trailing `/`, and adds `http://` if no scheme is given, so `localhost:5005` becomes `http://localhost:5005`. It parses in strict mode.

### `static bool IsInsecureRemote(const QUrl&)`
Returns true for **plain `http://` to any host other than this machine** (neither `localhost` nor a loopback IP). The login dialog warns in this case because the password would cross the network unencrypted.

### `QString savedEmail() const`, `bool isSignedIn() const`, `const RemoteUser& user() const`, `QUrl serverUrl() const`
Simple accessors. `isSignedIn()` is true when the token is not empty.

### `void signIn(const QUrl& server, const QString& email, const QString& password, bool remember)`
1. Cancels any earlier sign-in.
2. POSTs `{email, password, remember}` as JSON to `/api/v1/auth/login`.
3. When it finishes, the result is ignored if the request was cancelled (`m_signInReply` no longer matches). A non-200 status emits `signInFinished(false, ReplyError)`.
4. It takes the token from the `Set-Cookie: genesis_session=…` header and the user from the body. If either is missing, it reports *"The server's reply wasn't understood"*.
5. It saves the server and email. **Only the token is ever stored, never the password**, and only when `remember` is set. Otherwise any saved session is removed.
6. `setSession()`, then logs and emits `signInFinished(true, "")`.

### `void cancelSignIn()`
Clears `m_signInReply` **first**, so the finished handler knows the abort was on purpose, then aborts the reply.

### `bool hasSavedSession() const`
Returns true if `account/session` exists in QSettings.

### `void restoreSession()`
If a token is saved and the client is not signed in, it GETs `/auth/me` with that token:
- **200:** adopts the session.
- **401:** the session expired or was revoked. Deletes the saved token and emits `sessionChanged`.
- **Anything else** (server down): keeps the saved token for a later retry and emits `requestFailed`.

### `void signOut()`
Best effort: POSTs `/auth/logout` without waiting for the reply. It cancels any download, **deletes this account's download cache folder** so the next person using the PC cannot open the models, then calls `clearSession(true)`.

### `void fetchJobs()`
GETs `/api/v1/jobs`. A 401 clears the session and emits `requestFailed("Your session has expired…")`. A response that is not 200 or not an array emits `requestFailed`. Otherwise it parses every element and emits `jobsReceived(list)`.

### `void downloadResult(const RemoteJob& job, const QString& destPath)`
Only one download runs at a time.
1. Creates the folder and opens a `QSaveFile` on `destPath` for an atomic write. If that fails, it emits `downloadFinished(id, "", error)` immediately.
2. GETs `/jobs/<percent-encoded id>/result.ply`.
3. **Streams to disk** on every `readyRead` (only while the status is 200), because models can be hundreds of MB. An error reply's JSON stays in the reply buffer for `ReplyError` to read.
4. Forwards `downloadProgress(received, total)`.
5. When it finishes: if cancelled, the error is *"Download cancelled."*; if the HTTP status or network failed, it uses `ReplyError`; otherwise it writes the remainder and `commit()`s, which renames the temp file into place. On any error it calls `cancelWriting()`, so no half-written `.ply` is left behind. A 401 replaces the error with a session-expired message. It then emits `downloadFinished(id, pathOrEmpty, error)`.

### `void cancelDownload()`
Sets `m_downloadCancelled` and aborts the reply. `isDownloading()` is true while `m_download` is set.

### `QString cacheDir() const`
Returns `remote-models/<first 16 hex chars of SHA-1(server + "\n" + lowercase email)>`, one folder per server and account, so accounts sharing a PC never see each other's downloads. It returns an empty string when signed out.

### `static bool IsCachedModel(const QString& path)`
Returns true if `path` is inside the cache root of any account (case-insensitive prefix match). The editor uses it to treat those files as temporary downloads.

## Private functions

- **`MakeRequest(server, path, token)`**: builds the URL as `server.path + "/api/v1" + path` and, if a token is given, attaches the `genesis_session` cookie.
- **`handleUnauthorized(reply)`**: if the status is 401 while signed in, logs a warning, clears the session and returns true.
- **`setSession(token, user)`**: saves both values and emits `sessionChanged`.
- **`clearSession(forgetSaved)`**: cancels the download, clears the token and user, optionally deletes the saved token, and emits `sessionChanged`.

## Signals
`sessionChanged()`, `signInFinished(ok, error)`, `jobsReceived(jobs)`, `requestFailed(error)`, `downloadProgress(received, total)`, and `downloadFinished(jobId, path, error)`, where `error` is empty on success.
