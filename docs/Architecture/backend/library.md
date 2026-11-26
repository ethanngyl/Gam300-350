# `backend/library.js`

*Author: Gabriel.* The **client-machine side of the shared library**. Team machines with a GPU build models locally. This file sends each finished job (photos and final model) to the **VM**, which stores it for every machine, and passes on Library requests for jobs this machine does not have. Every request carries the shared `AUTH_API_KEY` and the id of the user it is made for. The VM looks that user (and their role) up in its own database and applies the normal owner/admin rule. The VM side of this is the `/library` routes ([routes/libraryStore](routes/libraryStore.md)), and every call goes to `/api/v1/library/...`.

## Constants
`SYNC_TIMEOUT_MS = 10 min` (uploading a whole job), `LIST_TIMEOUT_MS = 8 s` (small requests fail fast so the page is not held up), `PROXY_HEADERS_TIMEOUT_MS = 15 s` (for streamed files, how long to wait for the VM to start answering). `syncRunning` guards against overlapping sync rounds.

## Functions

### `vmHeaders(user)` *(private)*
`{ 'X-Auth-Key': authApiKey }`, plus `X-Act-As-User: <id>` when the request is made for a user.

### `syncJob(record)` *(exported)*
Builds `multipart/form-data` with:
- `ownerId` (on a client machine, local ids **are** the VM's ids);
- `origin` (the machine name) and `status` (the `status.json` text);
- every photo (`images`), using `fs.openAsBlob` so files are streamed rather than loaded into memory;
- `result.ply`, and `metrics.json` and `cover.webp` if present.

It sends `PUT /api/v1/library/jobs/<id>` with a 10-minute timeout. On a 2xx response it calls `markJobSynced` and returns true. If the VM is out of disk space it returns `'full'`. Any other failure is logged and returns false, so the next round tries again.

### `syncPendingJobs()` *(exported)*
Runs one round at a time. Scans the jobs and, for each `done` job with a result that has not been synced and is not still running in memory, calls `syncJob`. It **stops early on `'full'`**.

### `startLibrarySync()` *(exported)*
Runs `syncPendingJobs()` now (which also sends jobs made before the library existed), then every `syncIntervalMin` minutes on an `unref`'d timer, to retry anything the VM missed.

### `fetchRemoteJobs(user)` *(exported)*
`GET /api/v1/library/jobs` as the user, in the same shape as `GET /jobs`. Returns the array, or `null` if the VM could not be reached or answered with an error.

### `proxyToVm(req, res, vmPath)` *(exported)*
Forwards a browser request to the VM as the logged-in user and **streams the reply back**.
- Passes the **`Range`** header on, because the 3D viewer first asks for only the first 4 KB of a `.ply`. A non-empty JSON body (for example a rename) is passed on too.
- Aborts if the VM has not sent headers within 15 s, or if the browser disconnects.
- Copies the status and the headers a browser needs: `content-type`, `content-range`, `accept-ranges`, `last-modified`, `etag`, `cache-control`, and `content-length` **only when the reply was not compressed** (`fetch` undoes any compression).
- Pipes `Readable.fromWeb(resp.body)` to `res`. HEAD requests end with no body.
- On error, replies **503** *"The shared library is unavailable."* if no headers have been sent yet.

### `forwardToVm(method, vmPath, user, body, contentType)` *(exported)*
A small request as the user with an 8 s timeout. The body is sent as JSON, or as a raw Buffer with the given `contentType` (for example a profile photo). Returns `{ status, data }`, with **`status: 0`** if the VM could not be reached. Used to keep the VM's copy in step when a synced job is renamed or deleted locally.

### `isForVm(req)` *(exported)*
True on a team machine (`authMode === 'client'`) for its own routes whose data lives on the VM (account, feedback, scenes), but **not** for the VM's `/library` versions of those routes.

### `askVm(req, method, vmPath, { body, contentType, unavailable })` *(exported)*
If `clientAuthProblem()` reports a problem (no key or address), it returns `{ status: 503, data: unavailable }`. Otherwise it calls `forwardToVm`, and also returns 503 with `unavailable` when the VM cannot be reached (status 0).
