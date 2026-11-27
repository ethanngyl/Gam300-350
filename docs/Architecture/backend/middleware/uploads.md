# `backend/middleware/uploads.js`

API layer: **receiving uploaded files** with **multer**, plus content checks with **file-type**.

## Photo uploads (`POST /jobs`)

### `assignJobId(req, _res, next)`
Runs **before multer**. Sets `req.jobId = crypto.randomUUID()` and `req._fileIdx = 0`, and creates `jobs/<id>/images/`, so every file in the request goes into the same job folder.

### `storage` *(private)*
`multer.diskStorage` into `images/`, naming files **in order**: `0000.jpg`, `0001.png`, … (the original extension in lower case, `.jpg` if there is none). COLMAP does not care about the original names.

### `upload`
`multer({ storage, limits: { fileSize: maxFileSizeMB, files: maxFiles } })`, with a `fileFilter` that accepts only a **declared** MIME type of `image/jpeg` or `image/png`.

### `onlyImages(req, res, next)`
multer's filter trusts the type the client declares, so this **re-reads the actual bytes** of every file with `fileTypeFromFile`. If any file is not a real JPEG or PNG, it **deletes the whole job folder** and replies **400** `{ error: 'Invalid file content -- only real JPEG or PNG images are accepted.', detected }`. File-system errors go to `next(err)`.

## Media uploads (`POST /jobs/from-media`, the Frame Extractor)

### `MEDIA_EXT_RE`
`mp4|m4v|mov|webm|mkv|avi|mpe?g|gif`. Files are filtered by **extension**, because browsers often send no MIME type for formats like `.mkv`. `FrameExtractor.jsx` checks the same list.

### `mediaUpload`
Disk storage into `jobs/<id>/media/` (created as needed) with ordered names, so the videos are extracted in the order they were sent. Limits: `maxMediaSizeMB` and `maxMediaFiles`.

### `removeJobIfAborted(req, res, next)`
Runs **before multer**. A large upload can be abandoned part-way (Cancel, a closed tab, a lost connection). On `res.close`, if no job was created, it deletes the job folder and any partial files, with retries, because Windows can briefly lock a partial file.

### `onlyMedia(req, res, next)`
Like `onlyImages`, but each file's real type must be `video/*` or `image/gif`. Otherwise it deletes the folder and replies 400 *"\"name\" isn't a video or GIF file."*

## Shared library (VM only): `PUT /library/jobs/:id`

### `requireFreeDisk`
Uses `fs.promises.statfs(jobsDir)`. If free space is below `minFreeDiskGB`, it logs a warning and replies **507**, **before** any of the upload is written. Client machines treat 507 as "full" and stop their sync round.

### `prepareStore(req, res, next)`
Checks the id (`JOB_ID_RE`, not ending in `_out`; otherwise 404). Creates a hidden staging folder `jobs/.incoming-<uuid>/` laid out as `<id>/images/` and `<id>_out/`, and sets `req.storeDir`. `server.js` deletes leftover `.incoming-*` folders at startup.

### `storeUpload`
multer: `images` files keep the **client's names** (`0000.jpg`, …) so their URLs stay the same. `result`, `metrics` and `cover` get the fixed names `result.ply`, `metrics.json` and `cover.webp`. The filter accepts only images with safe names (`/^[\w.-]+$/` plus an image extension) and those three known fields; **anything else is dropped**. Limits: `maxResultSizeMB` per file and `maxFiles + 3` files.

### `readFileHead(filePath, count)`
Returns up to the first `count` bytes as a Buffer, used to check what a file really is (for example the `ply` magic bytes).
