# `backend/status.js`

*Author: Gabriel.* Saves each job's state to `<jobsDir>/<id>/status.json` and reads it back. This file is the copy of the job on disk that survives a restart. Running jobs live in memory ([pipeline.js](pipeline.md)), and [scan.js](scan.md) reads these files at startup. The format is `schemas/job-status.schema.json`.

## Constants
- `STATUS_FILE = 'status.json'`, `STATUS_VERSION = 1`.
- `STATUS_UPGRADES = {}`: converters keyed by the version they start from. There are none yet, because every record written so far is version 1. Old converters are never removed, so any old record can still be loaded.
- `CORE_FIELDS = {version, id, status}`: without these a record cannot be used at all.
- `VALID_STATUS`, `TERMINAL_STATUS` (`done`, `error`, `cancelled`).
- `THROTTLE_MS = 2000`: progress updates arrive on almost every log line, so the file is not rewritten that often.
- `LOG_TAIL_LINES = 40`.
- `warnedNewer` / `warnedFields`: each warning is logged once per job.

## Functions

### `saveJob(job, { throttle = false })` *(exported)*
- **Synchronous on purpose.** The record is tiny, and the shutdown handler needs it to work where async code never runs. It **never throws**, because failing to save must not fail a reconstruction.
- With `throttle`, it skips the write if the last save was less than 2 s ago.
- It does nothing if the job folder has been deleted, so the folder is never recreated.
- It writes: `version, id, status, phase, progress, detail, error, source, name, sampleFile, imageCount, removeBackground, autoCrop, trainIters, createdAt, updatedAt` and `result` (the path **relative to `jobsDir`**, with forward slashes, so moving `JOBS_DIR` does not break old records). For a finished job it also writes `logTail` (the last 40 lines), so a failure can still be diagnosed after a restart.
- **Write, then rename** (`.tmp` → final), so a crash part-way through cannot leave half a record. If Windows refuses the rename because another process has the file open, it writes directly instead.

### `upgradeStatus(record)` *(exported)*
Steps the record up through `STATUS_UPGRADES` one version at a time until it reaches `STATUS_VERSION`. Returns `null` if the version is missing, not an integer, **newer than this build**, or has no converter.

### `readStatus(id, jobsDir)` *(exported, async)*
1. Reads and parses the file. Returns `null` if it is missing or unreadable, or if its `id` does not match.
2. A record from a newer version is warned about once and ignored. The job is then rebuilt from its folder, as for a missing record.
3. Runs `upgradeStatus`. An unknown status returns `null`.
4. Validates against `job-status` with `schemaErrors`, and takes the top-level field name of each error from its `instancePath` (for example `/logTail/3` gives `logTail`). If a **core** field is bad, it returns `null`. Otherwise it **drops only the bad fields**, warning once, and returns the rest, so a hand-edited record keeps its name, status and error.
