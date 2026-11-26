# `backend/dbstore.js`

*Author: Gabriel.* Used on the VM with `FILE_STORE=db`. There, finished jobs' photos and models are kept **inside the database** (`job_images`, `job_models` and `job_model_chunks`) instead of as files. COLMAP and Brush need real files, so a job keeps its files while it is being built. Once the job ends, its photos move into the database whether it finished, failed or was cancelled, and its model moves too if it finished. `status.json`, `metrics.json` and covers stay as files. The VM also keeps no copies of models in the engine's samples folder.

## Functions

### `hasImagesOnDisk(jobId)` *(private)*
True if `jobs/<id>/images` contains any JPEG or PNG.

### `removeSampleCopy(job)` *(private)*
Deletes `engineSamplesDir/<sampleFileName(job)>` if it exists. Only the job's own file is touched, because its name is either the short job id or a name chosen on rename that never clashes with an existing file, so the repo's own sample `.ply` files are safe. Returns true if a copy was deleted.

### `moveImagesToDb(jobId)` *(exported)*
Calls `storeJobImages(jobId, imagesDir)`, which is one transaction. **Only after that succeeds** does it delete the folder (with retries). If storing fails, the photos stay on disk and an error is logged. If the delete fails, the photos are safely stored and the leftover copy is served from disk until it is removed. Never throws. Returns `{ count, bytes }` or `null`.

### `moveModelToDb(job)` *(exported)*
Does the same for the result `.ply` with `storeJobModel`, then also calls `removeSampleCopy`. `job.resultPath` is left unchanged: it still names the model, and `GET result.ply` serves it from the database once the file is gone. Never throws. Returns `{ size }` or `null`.

### `migrateToDb()` *(exported)*
Runs once at startup, before jobs are restored and while nothing is being built. It handles the one-time move when `FILE_STORE=db` is first turned on, and acts as a safety net after a crash.
1. Lists the job folders and reads each `status.json`. It collects **finished** jobs (with result paths) and **waiting** (`queued`) jobs. Waiting jobs keep their photos as files, because their builds still need them.
2. If there are photos to move and the database holds none yet, or models to move and the database holds none yet, it **backs up the database once** with `backupDatabase()`. Later backups would each copy every stored file, and each job's move is already all-or-nothing.
3. Moves the pending photos, then the pending models, and logs the counts and MB moved.
4. Removes engine samples copies of models that are already in the database.
