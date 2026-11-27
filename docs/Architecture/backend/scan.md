# `backend/scan.js`

*Author: Gabriel.* Rebuilds job records from the job folders on disk, so jobs survive a server restart. It only reads files and returns plain data: no Express and no in-memory map. `server.js` and `restoreJob` decide how to merge the records with live jobs.

Layout it understands:
```
<jobsDir>/<id>/images/         uploaded photos / extracted frames
<jobsDir>/<id>/status.json     saved state (status.js)
<jobsDir>/<id>/database.db     COLMAP has started
<jobsDir>/<id>/sparse/         COLMAP mapping has started
<jobsDir>/<id>_out/result.ply  normalized result (else the newest splat_*.ply)
```

## Exports and constants
- `IMAGE_EXT_RE = /\.(jpe?g|png)$/i`
- `JOB_ID_RE = /^[\w-]+$/`: job ids become path segments, so only plain filename characters are accepted.
- `INTERRUPTED`: *"Interrupted -- the server stopped during processing."*

## Functions

### `setImageNameSource(fn)` / `setModelSource(fn)`
Set by `server.js` when photos and models live in the database (the VM with `FILE_STORE=db`), so this file stays free of database code. `fn(jobId)` returns the photo names, or whether the database holds the model.

### `exists(p)` *(private)*
`fsp.access`, returning true or false.

### `highestRawPly(outDir)` *(exported)*
The highest-iteration Brush export in `<id>_out`, ignoring `result.ply`. The names are zero-padded (`splat_00500`, `splat_07000`), so an alphabetical sort puts the highest last. Returns `null` if the folder is missing or has no `.ply` files.

### `scanJob(id, jobsDir)` *(exported)*
Returns `null` for an invalid id, for `_out` folders, or if no photos are found (on disk or, failing that, from `imageNameSource`). It **never throws**, so one broken folder cannot break the whole list.
- **With a `status.json`:** it takes the status, phase, progress and error from it. The result path is dropped if the file is missing and `modelSource` does not know about it. Then:
  - `running`, or `queued` with COLMAP files present, becomes **error / interrupted** (`needsWrite`);
  - `done` with no result becomes **error, "Result file is missing."**
- **Without one:** it infers the state from the files. A `result.ply` or raw export means `done`. COLMAP files without a result mean interrupted. Otherwise `queued/upload`. `needsWrite` is set so the record gets written.
- Returns `{ id, status, phase, progress, error, detail, source, name, sampleFile, removeBackground, autoCrop, trainIters, hasRecord, createdAt (birthtime, falling back to mtime), updatedAt, imageCount, resultPath, hasResult, logTail, needsWrite, thumbnail (first image URL), images [{name, url}] }`.

### `scanJobs(jobsDir)` *(exported)*
Runs `scanJob` on every subfolder in parallel, drops the `null`s, and sorts **newest first** by `createdAt`. Returns `[]` if the jobs folder cannot be read.
