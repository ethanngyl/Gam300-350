# `backend/services/jobs.js`

Business logic for reconstruction jobs that the routes share. There is no `req` or `res` here. The pipeline itself is in [pipeline.js](../pipeline.md).

## Constants and state
- `MAX_JOB_NAME_LENGTH = 80`.
- `buildQueue = createJobQueue({ maxPerOwner: maxRunningJobsPerUser, maxRunning: maxRunningJobs, ownerOf: jobOwner, onChange: showPlacesInLine })` ([jobQueue.js](../jobQueue.md)).
- Cover state: `coversInProgress` (Map) and `coversFailed` (Set; a failed cover is not retried until restart).
- Thumbnail state: `thumbsInProgress`, `thumbsLastRun`, `THUMB_RETRY_MS = 10 min`, `THUMB_RUNS_AT_ONCE = 2`, and a semaphore made of `thumbRunsActive` and `thumbRunQueue`.

## Functions

### `jobOwner(job)` *(private)*
`getJobOwnerId(job.id)`, or `null` (no owner, or a database error, which is logged). Jobs with no owner share one count.

### `showPlacesInLine(waiting)` *(private)*
For each waiting job it sets `status 'queued'` (the website shows *Waiting to start*), phase `upload`, and progress 0, or 0.05 for media jobs, so their finished extraction stays on the bar. It sets `detail` to *"Waiting for your earlier build(s) to finish"* or *"Waiting for N build(s) ahead of yours"*, and saves only if something changed.

### `queueBuild(job)` *(exported)*
`buildQueue.enqueue(job, () => { job.detail = null; return runPipeline(job) })`. The returned promise settles when the build ends or the job is cancelled while waiting, and never rejects.

### `refreshQueue()` *(exported)*
`buildQueue.refresh()`. Call it after `cancelJob` so the other jobs' places update straight away.

### `getJob(id)` *(exported, async)*
The live job from `jobs`. Failing that, `scanJob(id)` and `restoreJob(record)`, which covers job folders that appeared after startup. Returns `null` if there is no such job.

### `parseTrainIters(value)` *(exported)*
Rounds the value (a string from a multipart form or a number from JSON). It returns `null` (meaning use `config.trainIters`) if the value is not a positive number, and otherwise clamps it to `minTrainIters`–`maxTrainIters`.

### `frameOptions(fps, maxFrames)` *(exported)*
`{ fps: min(fps, frameMaxFps), maxFrames: min(maxFrames, maxFiles) }`. Each key is included only if its value is a positive number.

### `ensureCover(jobId)` *(exported)*
The job card's **cover**: the object cut out of a photo using the job's background masks, saved as `<id>_out/cover.webp`, so deleting the job removes it.
- If it already exists, resolves with the path. If it failed before, rejects. If it is being made, returns the run in progress, so concurrent requests share **one** run.
- Otherwise it requires `masks/` and runs `python make_cover.py images masks cover.webp` (60 s timeout). A failure adds the job to `coversFailed`.

### `thumbPath(jobId, name)` *(exported)*
`<id>_out/thumbs/<name>.webp`. It lives under `_out`, so deleting the job removes it and the VM's storage budget counts it.

### `takeThumbRun()` / `releaseThumbRun()` *(private)*
A semaphore allowing at most **2** Python thumbnail runs at once, so opening a large Library for the first time does not start dozens.

### `ensureThumbs(jobId, { force = false })` *(exported)*
Small WebP copies of **every** photo in one Python run (`make_thumbs.py images thumbs`, 120 s timeout).
- Joins a run already in progress, or, with `force`, waits for it and then runs again.
- Without `force`, it skips the job if it ran within the last 10 minutes, so a photo Pillow cannot read, or a machine without Pillow, does not start Python on every card.
- **VM with photos in the database:** writes the photos that have no thumbnail yet to a temporary folder first, and deletes that folder afterwards.
- **Never rejects.** A failure is logged, and the caller serves the original photo instead.

### `afterJobEnds(job)` *(exported)*
Tidies up a job once it has ended, in an order that keeps what each step needs:
1. **done** with masks: `ensureCover`, while the photos and masks still exist;
2. **done**: `pruneJob`, which deletes COLMAP and Brush working files and the masks;
3. **done**, client machine: `syncPendingJobs()` sends the job to the VM;
4. **done**, VM with `FILE_STORE=db`: `moveModelToDb`;
5. `ensureThumbs(…, { force: true })`, while the photos are still files;
6. VM with `FILE_STORE=db`: `moveImagesToDb`, which also applies to failed and cancelled jobs so their photos are kept;
7. Authority: `requestCleanup()`, because storage has just grown.

It never throws; each step logs its own problems.
