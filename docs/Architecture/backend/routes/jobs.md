# `backend/routes/jobs.js`

API layer: the **reconstruction job routes** (an Express `Router`). On the VM, each job route is also served under `/library/...` for client machines; the `/library` middleware in `server.js` checks the shared key first. Each path is mounted at both `/api/v1/…` and the legacy path.

## Per-user rate limits (admins are exempt)
- **`limitBuilds`**: `RATE_LIMIT_BUILDS_PER_HOUR` (10) **and** `_PER_DAY` (30). **Only accepted builds (202) count.** Message: *"You've started too many builds. Try again in …"*.
- **`limitDownloads`**: `RATE_LIMIT_DOWNLOADS_PER_HOUR` (60). Only a **full** download counts (a GET answered 200), not a HEAD, a 206 range read or a 304.

## Routes

### `POST /upload`
Middleware order: `requireUser` (runs **before** `assignJobId`, so a request from someone not signed in never creates a folder), `limitBuilds`, `assignJobId`, `upload.array('images', maxFiles)`, `onlyImages`.
- Fewer than `catalog.minPhotos` (8) photos: deletes the folder and returns **400** *"Need at least 8 photos (got N)…"*.
- Otherwise `setJobOwner`, `makeJob` (with `imageCount` and `source: 'upload'`), and the optional multipart fields `removeBackground` and `autoCrop` (`true`, `1` or `on`) and `trainIters` (`parseTrainIters`). Then `saveJob`.
- **Fire and forget:** `queueBuild(job).finally(() => afterJobEnds(job))`.
- Returns **202** `{ id, imageCount }`. The frontend then polls for status.

### `POST /jobs/from-media`
`requireUser`, `limitBuilds`, `assignJobId`, `removeJobIfAborted`, `mediaUpload.array('media', maxMediaFiles)`, `onlyMedia`.
- **If the browser hung up** after sending the files but before this reply (`res.destroyed`), it deletes the folder and returns without starting a job, because the browser would never learn its id.
- No files: 400.
- Owner, `makeJob` with `source: 'media'` and the same flags. `runMediaPipeline(job, frameOptions(fps, maxFrames), queueBuild).finally(afterJobEnds)`. **Frames are extracted straight away, and the build after them waits its turn.**
- Returns **202** `{ id }`.

### `GET /jobs`, `GET /library/jobs`
`requireUser`. Returns `listJobs(req)` from [adapters/jobSources](../adapters/jobSources.md) as a `JobSummary[]`. Admins get every job, other users only their own. On a team machine the VM's jobs are merged in, and the local copy wins.

### `GET /jobs/:id/images/:name` (+ `/library`)
`requireJobAccess`.
- `size` must be absent or `small`, otherwise 400. Remote jobs are passed to the VM with `proxyToVm`.
- **Path safety:** `id` must match `JOB_ID_RE`, and `name` must match `^[\w.-]+$` and have an image extension, so a request cannot use `..` or slashes to escape the jobs folder. Otherwise 404.
- `?size=small`: `ensureThumbs`, then sends `<id>_out/thumbs/<name>.webp` with `Cache-Control: private, max-age=86400`. **If no small copy can be made, it sends the original.**
- With photos in the database: `getDbImage` with the right MIME type and `max-age=3600`. Otherwise `res.sendFile`, or 404 on error.

### `GET /jobs/:id` (+ `/library`)
`requireJobAccess`. Remote jobs are proxied. Returns `{ id, status, phase, progress, detail, error, updatedAt, imageCount, removeBackground, autoCrop, hasResult, logTail: last 40 log lines }`, or 404. This is the polling endpoint, and the engine's `JobStatus` uses the same fields.

### `DELETE /jobs/:id` (+ `/library`)
**Cancel.** Proxies remote jobs. 404 if the job is not found. If it is already cancelled, returns the status unchanged (so the call can safely be repeated). If `cancelJob` returns false because the job had already finished, **409**. Otherwise it calls `refreshQueue()` (a job cancelled while waiting leaves the queue at once) and returns `{ id, status }`. Killing the tool frees the GPU straight away.

### `GET /jobs/:id/result.ply` (+ `/library`)
`requireJobAccess`, `limitDownloads`. Proxies remote jobs, **including range requests**. 404 *"result not ready"* unless the job is done with a result. If the file has moved into the database, it uses `sendDbModel`. Otherwise `sendFile` as `application/octet-stream`.

### `GET /jobs/:id/cover.webp` (+ `/library`)
`ensureCover(id)`, then sends the file with `max-age=86400`. On failure, 404 `no cover`; the cards then show the first photo instead.

### `PATCH /jobs/:id` (+ `/library`)
**Rename.** The body is `{ name }`. More than 80 characters gives 400. An empty name resets to the default.
- Renames the engine samples copy from `sampleFileName(job)` to `pickSampleFileName(job, name)`. If there is no copy yet (`ENOENT`), only the new name is recorded, and the pipeline uses it when it copies. Any other rename error gives **409**.
- Saves `job.name` and `job.sampleFile`.
- **Client mode:** if the job has been synced, it also sends a best-effort `PATCH` to the VM, and logs if the VM could not be updated.
- Returns `{ id, name, sampleFile }`.

### `DELETE /jobs/:id/files` (+ `/library`)
**Permanent delete.** Proxies remote jobs. In client mode with a synced job, it **deletes the VM's copy first** (anything other than 200 or 404 gives **502**), because otherwise the job would come back in the Library from the VM, and then unmarks it as synced. Then `deleteJobData(job)` (which cancels a running job first), `refreshQueue()`, and returns `{ id, deleted: true }`.
