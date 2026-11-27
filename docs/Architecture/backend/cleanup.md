# `backend/cleanup.js`

*Author: Gabriel.* Keeps the **VM's storage** in check. Stored jobs (photos and model, in the database or on disk) are kept under a size budget (`STORAGE_BUDGET_GB`). When storage goes over, whole jobs are deleted, **oldest first**, until it is down to **90% of the budget**. Running jobs and jobs younger than `CLEANUP_MIN_AGE_DAYS` are never deleted. Feedback older than `FEEDBACK_KEEP_DAYS` is deleted. Database backups are not touched.

The budget counts the **bytes each job stores**, not the disk's free space. Deleting rows from `app.db` frees space inside the file, which SQLite reuses for new jobs, but the file does not shrink, so the disk's free space would not go up.

## Constants
`TARGET_SHARE = 0.9`, so the next job does not immediately push storage over again. `REQUEST_DELAY_MS = 10 s`, so a burst of new jobs makes one pass. `currentRun` holds the pass in progress, and `requestTimer` holds a pass waiting to start.

## Functions

### `formatSize(bytes)` *(private)*
`"212.4 MB"` or `"20.41 GB"`, for log lines.

### `folderBytes(dir)` *(private)*
Adds up the size of every file under `dir`, recursively. A missing folder gives 0, and files deleted while counting are ignored.

### `jobStoredBytes(jobId)` *(exported)*
`getDbJobBytes(id)` plus the folder sizes of `jobs/<id>/` and `jobs/<id>_out/`. The account page's storage figure uses it too.

### `deleteJobData(job)` *(exported)*
Deletes a job everywhere: `cancelJob(job)` (which does nothing if the job has finished), `jobs.delete(id)`, then removes both folders (10 retries, 300 ms apart, because Windows briefly locks the files of a tool that was just killed), its engine samples copy, and its database photos and model. It throws if a folder cannot be removed. `DELETE /jobs/:id/files` uses it too.

### `trimJobsToBudget()` *(private)*
Sizes every scanned job. If the total is within budget it returns. Otherwise it sorts the jobs oldest first and deletes each one that is **not queued or running** and **older than the minimum age**, until the total is at or below 90% of the budget. It logs each deletion (id, name, date, size) and a summary, and warns if it is still over budget, because the remaining jobs are running or too new.

### `runCleanup()` *(exported)*
One pass: old feedback (if `feedbackKeepDays > 0`), then `trimJobsToBudget()` (if a budget is set). **If a pass is already running, it returns that pass** instead of starting another, so two passes never delete at the same time. It never rejects.

### `requestCleanup()` *(exported)*
Called after a new job is stored, which is the only time storage grows. It schedules `runCleanup()` in 10 s, and further requests during that time join the same pass. The timer is `unref`'d.

### `startCleanup()` *(exported)*
Runs a pass now, then every `cleanupIntervalMin` minutes on an `unref`'d interval. Started by `server.js` on the authority (the VM) only.
