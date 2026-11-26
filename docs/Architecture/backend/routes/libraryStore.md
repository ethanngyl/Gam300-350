# `backend/routes/libraryStore.js`

API layer: **`PUT /library/jobs/:id`**. This is the **VM** receiving a finished job from a client machine ([library.js `syncJob`](../library.md)), checking it, and storing it so it is served exactly like a job made on the VM. The `/library` middleware has already checked the shared key.

## `PUT /library/jobs/:id`
Middleware: `requireFreeDisk` (507 when the disk is nearly full), `prepareStore` (validates the id and creates the staging folder `jobs/.incoming-<uuid>/`, which `scanJobs` ignores because the name starts with a dot), then `storeUpload.fields([images, result (1), metrics (1), cover (1)])`.

Multipart fields: `images`, `result` (the `.ply`), optional `metrics` and `cover`, `status` (the job's `status.json` as text), `ownerId` (a VM user id, or empty) and `origin` (the sending machine's name).

1. Requires at least one photo **and** a result, otherwise 400. Every photo must be under the photo size limit and **really be a JPEG or PNG** (checked with `fileTypeFromFile`). The result must start with the bytes **`ply`**. A cover that is not a real **WebP** (`RIFF…WEBP`) is **dropped** rather than rejecting the job.
2. **Writes a fresh status record.** It never trusts paths sent by the client. Only harmless fields are copied: `source` (one of `upload`, `media`, or the old `youtube`/`video`), `name` (up to 80 characters), `removeBackground`, `autoCrop`, `createdAt` and `logTail` (the last 40 lines, as strings). Everything else is fixed: `status/phase: done`, `progress: 1`, `result: <id>_out/result.ply`, `sampleFile: null`.
3. If a job with this id is **running on the VM**, it returns **409**.
4. **`FILE_STORE=db`:** stores the photos and model in the database and removes the staged copies.
5. **Replaces any earlier copy:** deletes the live job and both existing folders, renames the staged folders into `jobs/`, and deletes the staging folder.
6. `ownerId` is kept only if the VM knows that user; otherwise the job becomes **admin-only**. `origin` is cut to 100 characters, and `bytes` is the total size of the files. Calls `recordStoredJob`, then `scanJob` and `restoreJob` to load it into memory, and `requestCleanup()`.
7. Returns **201 `{ id, bytes }`**.

Any rejection or error deletes the staging folder first (`reject(status, error)`, or the `catch` block, which calls `next(err)`).
