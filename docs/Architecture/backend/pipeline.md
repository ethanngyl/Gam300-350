# `backend/pipeline.js`

*Authors: Xiong Yang, Gabriel.* The **reconstruction engine**. It holds the in-memory job store and runs the pipeline for each job: photos, then COLMAP, then Brush, then a normalized `.ply`, with an optional frame-extraction step in front. It starts and tracks every tool process (COLMAP, Brush, Python), so jobs can be cancelled and nothing is left running on the GPU when the server stops. The engine has a C++ port of this file: [engine/pipeline/LocalReconstruction](../engine/pipeline/LocalReconstruction.md).

## `export const jobs = new Map()`
The in-memory job store. Each state change is also written to `<jobsDir>/<id>/status.json` by `saveJob` ([status.js](status.md)), so [scan.js](scan.md) can restore jobs after a restart.
- `status`: `queued | running | done | error | cancelled`
- `phase`: `upload | extract | masking | colmap-features | colmap-matching | colmap-mapping | training | crop | normalize | done`

## Functions

### `makeJob(id)` *(exported)*
Creates a job with these defaults and adds it to `jobs`: `status 'queued'`, `phase 'upload'`, `progress 0`, `log []`, `error null`, `createdAt now`, `resultPath null`, `detail null` (a short sub-status), `cancelled false`, `child null` (the running tool), `removeBackground false`, `autoCrop false`, `trainIters null` (meaning `config.trainIters`).

### `appendLog(job, line)`
Removes trailing whitespace, skips empty lines, and keeps **only the last 400 lines**, so long runs do not grow without limit in memory.

### `setPhase(job, phase, progress)`
`startPhase(job, phase)` (the per-phase timer in [metrics.js](metrics.md)), sets the phase and progress, and calls `saveJob(job)`. Phase changes are never throttled.

### `liveChildren` (Set) and `killChildren()` *(exported)*
Every running tool process. On Windows a child process does **not** die with its Node parent, so without this set a restart would leave Brush training as an orphan on the GPU. `killChildren` is **synchronous**, so it works in `process.on('exit')`.

### `killChild(child)`
Removes the process from the set and returns if it has already exited. **Windows:** `taskkill /PID <pid> /T /F` (5 s timeout), which kills the whole tree. **Other systems:** `process.kill(-pid, 'SIGKILL')`, which kills the process group (children are spawned `detached`), falling back to `child.kill`. Best effort, and it never throws.

### `cancelJob(job)` *(exported)*
Returns false if the job has already finished. Otherwise it sets `cancelled`, `status 'cancelled'` and `error 'Cancelled by user'`, logs and saves, and kills `job.child`. The pipeline's `catch` sees `cancelled` and leaves the status as `cancelled` rather than `error`.

### `run(job, bin, args, { cwd, onData, timeoutMs, env })`
A promise wrapper around `spawn`:
- Rejects at once if the job is already cancelled, so the next stage never starts.
- Logs `$ <tool> <args>`. Uses `windowsHide`, `detached` on non-Windows systems, and merges `env` over `process.env`.
- Tracks the child in `liveChildren` and `job.child`.
- An optional **watchdog** timer calls `killChild` after `timeoutMs`.
- Splits stdout and stderr into lines, appends each to the log and passes it to `onData`.
- On `close`, rejects with *"Cancelled by user"*, *"<tool> timed out after N min"*, *"<tool> was killed (signal)"* or *"<tool> exited with code N"*, and resolves on exit code 0. A spawn `error` rejects with *"Failed to start <bin>"*.

### `extractMediaFrames(job, { fps, maxFrames })` *(exported)*
Creates `images/`, sets the job to running in phase `extract`, and records the fps and frame limit in `job.metrics`. Runs `python extract_frames.py <media files sorted> --output images --fps N --max-frames N` with the frame timeout. `PROGRESS extract <f>` lines map to progress `0.05·f` and a detail like *"Extracting frames… N%"* (throttled saves). `ERROR: …` lines replace the plain exit-code message. The `media/` folder is deleted **whatever the outcome**, with retries, because Windows can briefly hold a just-killed tool's file. Returns the number of image files written.

### `runMediaPipeline(job, opts, build = runPipeline)` *(exported)*
Extracts the frames and saves `imageCount`. With fewer than `catalog.minPhotos` (8) frames it fails with advice (*"try a longer clip or a higher fps"*). Errors set the job to `error`, unless it was cancelled. It then calls `build(job)`. The server passes `queueBuild` here, so extraction (CPU) starts at once while the GPU build waits its turn.

### `generateMasks(job, imagesDir, jobDir)`
Turntable captures need masks: the still background otherwise makes COLMAP think the camera never moved. It runs `make_masks.py images --colmap-out colmap_stencils --brush-out masks --model <maskModel>`. Brush reads `masks/` automatically, and `colmap_stencils/` is kept in its own folder so Brush does not see two masks per image. Progress is read from `PROGRESS mask <f>` within the 0–5% band. Returns the COLMAP mask folder.

### `autoCropPly(job, sparseDir, rawPly, outDir)` *(exported)*
Phase `crop` at 98.5%. Runs `auto_crop.py sparse raw cropped.ply --report crop.json` and stores the report in `job.metrics.autoCrop`. Returns `cropped.ply` if it was cropped, otherwise `rawPly`. **Best effort:** a failure is logged and the whole model is kept.

### `NO_MODEL_MESSAGE`
*"COLMAP could not reconstruct a model from these photos. Try more photos with more overlap and texture."* Any mapper failure means the same thing to the user.

### `runPipeline(job)` *(exported)*
The full reconstruction. It produces the INRIA/COLMAP layout that Brush reads:
`images/`, `database.db`, `sparse/0/`, and `<jobsDir>/<id>_out/` (Brush exports plus `result.ply`).
1. Masks, if `removeBackground` is set.
2. **feature_extractor** (5%): single camera, masks, GPU flag.
3. **exhaustive_matcher** (20%): GPU flag plus the strict arguments.
4. **mapper** (35%): the strict and fast arguments. A failure other than a cancel or timeout is replaced with `NO_MODEL_MESSAGE` (the raw output stays in the log). It requires at least one numbered `sparse/<n>` folder and records `metrics.sparseModels`.
5. **Brush training** (45–98%): run from `jobsDir` with `<id> --max-resolution N <itersFlag> total --export-path ./<id>_out/ --export-name splat_{iter}.ply --export-every total`, plus `--alpha-mode transparent` when masked and supported. `RUST_LOG=info` is set because Brush hides its progress bar when stdout is a pipe; the log lines carry `iter=N`, which drive progress, `metrics.lastIteration` and the detail *"Iteration N / total"*. `startGpuSampler(job)` samples VRAM and utilisation during training.
6. Finds the highest-iteration export (`highestRawPly`). With none, it fails with *"Training finished but no .ply was exported."*
7. Optional **auto-crop**, done **before** normalizing so the model is centred on the object alone.
8. **Normalize** (99%): `normalize_ply.py in result.ply`. On failure it logs and serves the raw or cropped export.
9. `recordPlyMetrics(...)`: writes timing, iteration and hardware stats to `metrics.json` and `metrics.jsonl`. It never fails the job.
10. **Engine samples copy** (best effort): copies the result to `engineSamplesDir/<sampleFileName>`, unless `skipSampleCopy` is set (the VM with `FILE_STORE=db`).
11. Sets the job to `done` with progress 1.

The tidy-up (cover image, `pruneJob`, sending to the VM, moving files into the database) is done afterwards by `afterJobEnds` in [services/jobs.js](services/jobs.md).

### `setSkipSampleCopy(flag)` *(exported)*
Turns the engine samples copy off or on.

### `sampleFileName(job)` *(exported)*
`job.sampleFile`, or `<first 8 chars of id>.ply`.

### `pickSampleFileName(job, name)` *(exported)*
The samples filename for a new display name. It replaces every run of non-word characters with `_`, trims underscores, and cuts to 60 characters. An empty result gives the short id. A reserved Windows name (`con`, `nul`, `com1`, …) gets `_<shortId>` added. If another model's file already has the preferred name (compared **ignoring case**, as Windows does), it uses `<base>_<shortId>.ply`.

### `pruneJob(job)` *(exported)*
After a job finishes, it deletes `database.db`, `sparse/`, `masks/`, `colmap_stencils/` and every `.ply` in `_out/` other than the kept model. That is usually most of a job's disk space. It keeps `images/`, `status.json`, the final model, `metrics.json` and `cover.webp`. It never throws.

### `restoreJob(record)` *(exported)*
Creates a job with `makeJob` and copies in the scanned record: status, phase, progress, error, times, result path, image count, source, the **build settings** (so a queued job keeps them over a restart), name, sample file, and the log tail. If `record.needsWrite` is set (a missing `status.json`, or a corrected state such as running becoming interrupted), it saves the job.
