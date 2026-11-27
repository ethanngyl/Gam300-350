# `backend/adapters/jobSources/`

*Author: Gabriel.* **Job source adapters.** Each one turns jobs from one place into the common **`JobSummary`** format (`schemas/job-summary.schema.json`) that `GET /jobs` lists. The rest of the backend and every client see only this format, so a source can be added or swapped without changing them. Which sources are on is set by **`JOB_SOURCES`**: `live` (the default), `sample`, or `live,sample`.

---

## `index.js`
At import time, `sample.loadSamples()` runs if `sample` is on, so a bad sample file stops startup instead of breaking the first page load.

### `listJobs(req)`
- `forTeamMachine` is true when the path starts with `/library/`. The VM's own `/library/jobs` (asked by team machines) lists **only** real jobs from its folders.
- Asks every enabled source **in parallel** (the VM is a network call): `folders` and (unless `forTeamMachine`) `vmLibrary` for `live`, and `sample`.
- Merges them in that order, **keeping the first copy** of each job id (this machine's copy wins over the VM's), and rewrites `thumbnail`, `cover` and every image URL with `urlFor(req, …)`, so they match the request's API version.
- Sorts newest first.

---

## `jobSummary.js`
- **`JOB_STATUSES`**: `queued`, `running`, `done`, `error`, `cancelled`.
- **`makeJobSummary(fields)`**: exactly these fields, in schema order and with defaults: `id`, `name` (null), `status`, `phase` (null), `progress` (0), `detail`, `error`, `createdAt`, `updatedAt` (= `createdAt`), `imageCount` (0), `hasResult`, `thumbnail`, `cover`, `images` ([]).
- **`normalizeJobSummary(raw)`**: checks and converts a job from an outside source, such as the VM's JSON. It returns `null` without a valid id (`JOB_ID_RE`), status or `createdAt` (via `toMs`). Strings must really be strings. `progress` is clamped to 0–1. `imageCount` must be a non-negative integer, otherwise the image count is used. Images must have string `name` and `url`. `hasResult` must be exactly `true`.

---

## `folders.js` (source name `folders`)
The job folders on this machine (`scanJobs`), merged with the jobs running in memory. On the VM with `FILE_STORE=db` the folders still hold each `status.json`, so this source covers that case too.

### `listJobs(user)`
Scans **on every call**, so jobs from before a restart, or added by hand, appear. Non-admins see only their own job ids (`listOwnedJobIds`). For each record it uses the **live in-memory job** if there is one (the disk cannot tell running from interrupted), otherwise it calls `restoreJob(record)`. `cover` is `/jobs/<id>/cover.webp` if a `cover.webp` exists **or can still be made** from the job's `masks/`, otherwise `null`.

---

## `vmLibrary.js` (source name `vmLibrary`)
The VM's shared library, used on a team machine (`AUTH_MODE=client`).

### `listJobs(user)`
Returns `[]` unless the machine is in client mode with no `clientAuthProblem()`, or if the VM cannot be reached. Otherwise it calls `fetchRemoteJobs(user)` (the VM applies the owner/admin rule), runs every item through **`normalizeJobSummary`**, drops and warns about invalid items, and removes the `/api/v1` prefix from their URLs (`toUnversionedUrl`) so `index.js` can apply the request's own version.

---

## `sample.js` (source name `sample`)
Read-only **sample jobs** described in `sample-data/jobs.json` (`schemas/sample-jobs.schema.json`). They use files already in the repository: the engine's sample models and the *Sample Image Set* photos. This is useful for working on the website without a GPU or the VM.

- **`loadSamples()`**: reads and validates the file once, throwing an error that lists the problems. It builds a `Map` of id to the sample plus `photosPath` and `modelPath`, both resolved against the repository root.
- **`findSampleJob(id)`**: one sample or `null`. [routes/sampleJobs](../routes/sampleJobs.md) uses it.
- **`listJobs()`**: every sample as a `JobSummary`. Image URLs are `/jobs/<id>/images/<photo>`. `hasResult` is true when the status is `done` **and** the model file exists (the repository's sample models can be missing).
