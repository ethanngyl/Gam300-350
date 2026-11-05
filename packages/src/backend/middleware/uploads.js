/*!************************************************************************
\file uploads.js
\author1 Gabriel Sebastian Putra
\author2 Xiong Yang
\author3 Ethan Ng
\par DP email1: gabrielsebastian.p@digipen.edu
\par DP email2: xiong.yang@digipen.edu
\par DP email3: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
API layer: receiving uploaded files. Moved out of server.js.
- assignJobId(req, res, next)
Runs before multer. Generates a UUID job ID, resets a file counter on req,
and creates jobs/<id>/images/, so every file in the request goes into the
same job folder.
- upload(multer instance)
Saves photos to the job's images/ folder in order (0000.jpg, 0001.png, ...),
with size and count limits from config, accepting only files whose declared
MIME type is JPEG or PNG.
- onlyImages(req, res, next)
Reads each uploaded file's bytes and checks the real type with file-type. If
any file isn't really a JPEG or PNG, it deletes the whole job folder and
returns 400. This guards against a client that lies about the MIME type.
- mediaUpload(multer instance) / onlyMedia(req, res, next) /
  removeJobIfAborted(req, res, next)
The same for the Frame Extractor's videos and GIFs, saved to the job's media/
folder until their frames are extracted. removeJobIfAborted removes the job
folder if the browser gives up part-way through the upload.
- requireFreeDisk / prepareStore / storeUpload / readFileHead
On the VM: the checks and staging folder for PUT /library/jobs/:id, which
receives a finished job from a client machine.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import multer from 'multer'
import { config } from '../config.js'
import { jobs } from '../pipeline.js'
import { IMAGE_EXT_RE, JOB_ID_RE } from '../scan.js'

// ----- Start of Functions --------------------------------------------------- //

// --- Upload handling --------------------------------------------------------
// Assign a job id up front so every file in the request lands in one job folder.
/************************************************************************/
/*!
  \brief
    Assign a job id up front so every file in the request lands in one job 
    folder. Must run before multer
  \param req
    The request from the user
  \param _res
    The response from the backend
  \param next
    moving on
  \return 
    ensures the file in the request goes into the same job folder
*/
/************************************************************************/
export function assignJobId(req, _res, next) {
    req.jobId = crypto.randomUUID()
    req._fileIdx = 0
    fs.mkdirSync(path.join(config.jobsDir, req.jobId, 'images'), { recursive: true })
    next()
}

/************************************************************************/
/*!
  \brief
    Send files into the images folder and rename the images in order.
  \return 
    The image files default to jpg
*/
/************************************************************************/
const storage = multer.diskStorage({
    destination: (req, _file, cb) => cb(null, path.join(config.jobsDir, req.jobId, 'images')),

    filename: (req, file, cb) => {
        // Stable ordered names -- COLMAP doesn't care about the original name.
        const ext = (path.extname(file.originalname) || '.jpg').toLowerCase()
        cb(null, `${String(req._fileIdx++).padStart(4, '0')}${ext}`)
    },
})

/************************************************************************/
/*!
  \brief
    Make sures that only jpegs and pngs under a size limit is accepted.
  \return 
    nothing
*/
/************************************************************************/
export const upload = multer({
    storage,
    limits: { fileSize: config.maxFileSizeMB * 1024 * 1024, files: config.maxFiles },
    fileFilter: (_req, file, cb) => cb(null, /^image\/(jpe?g|png)$/i.test(file.mimetype))
})

// What the Frame Extractor accepts. Filtered by extension, because browsers
// often send no MIME type for formats like .mkv. FrameExtractor.jsx checks the same.
const MEDIA_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpe?g|gif)$/i

/************************************************************************/
/*!
  \brief
    Save the Frame Extractor's files into the job's media/ folder, under
    ordered names so they are extracted in the order they were sent.
  \return
    nothing
*/
/************************************************************************/
export const mediaUpload = multer({
    storage: multer.diskStorage({
        destination: (req, _file, cb) => {
            const mediaDir = path.join(config.jobsDir, req.jobId, 'media')
            fs.mkdirSync(mediaDir, { recursive: true })
            cb(null, mediaDir)
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase()
            cb(null, `${String(req._fileIdx++).padStart(4, '0')}${ext}`)
        },
    }),
    limits: { fileSize: config.maxMediaSizeMB * 1024 * 1024, files: config.maxMediaFiles },
    fileFilter: (_req, file, cb) => cb(null, MEDIA_EXT_RE.test(file.originalname)),
})

/************************************************************************/
/*!
  \brief
    A large upload can be abandoned part-way (Cancel, closed tab, lost
    connection). If the connection closes before a job was made, remove the
    folder assignJobId created, along with any partial files. Retries because
    on Windows the partial file can stay locked for a moment. Must run before
    multer.
  \param req
    The request from the user
  \param res
    The response from the backend
  \param next
    moving on
  \return
    nothing
*/
/************************************************************************/
export function removeJobIfAborted(req, res, next) {
    res.on('close', () => {
        if (jobs.has(req.jobId)) return
        fs.promises.rm(path.join(config.jobsDir, req.jobId), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
            .catch(() => {})
    })
    next()
}

/************************************************************************/
/*!
  \brief
    Content-level guard for the Frame Extractor, like onlyImages: reads the
    actual bytes of every uploaded file and rejects the whole batch (deleting
    the job folder) if any isn't really a video or GIF.
  \param req
    The request from the user
  \param res
    The response from the backend
  \param next
    moving on
  \return
    400 if a file isn't a video or GIF, and deletes the job folder.
*/
/************************************************************************/
export async function onlyMedia(req, res, next) {
    try {
        const { fileTypeFromFile } = await import('file-type')

        for (const file of req.files || []) {
            const type = await fileTypeFromFile(file.path)

            if (!type || !(type.mime.startsWith('video/') || type.mime === 'image/gif')) {
                await fs.promises.rm(path.join(config.jobsDir, req.jobId), { recursive: true, force: true })
                return res.status(400).json({
                    error: `"${file.originalname}" isn't a video or GIF file.`,
                    detected: type ? type.mime : 'unknown',
                })
            }
        }

        next()
    } catch (err) {
        next(err)
    }
}

/************************************************************************/
/*!
  \brief
    Content-level guard: multer's fileFilter only trusts the client-declared 
    MIME type. This re-inspects the actual bytes of every uploaded file and 
    rejects the whole batch (deleting the job folder) if any file isn't a 
    real JPEG/PNG.
  \param req
    The request from the user
  \param res
    The response from the backend
  \param next
    moving on
  \return 
    400 if file isn't jpeg or png and deletes job folder.
*/
/************************************************************************/
export async function onlyImages(req, res, next) {
    const files = req.files || []
    if (files.length === 0) return next()

    try {
        const { fileTypeFromFile } = await import('file-type')
        const legalMimes = ['image/jpeg', 'image/png']

        for (const file of files) {
            const type = await fileTypeFromFile(file.path)

            if (!type || !legalMimes.includes(type.mime)) {
                // Reject the batch: remove the job folder created up front by assignJobId.
                await fs.promises.rm(path.join(config.jobsDir, req.jobId), { recursive: true, force: true })
                return res.status(400).json({
                    error: 'Invalid file content -- only real JPEG or PNG images are accepted.',
                    detected: type ? type.mime : 'unknown',
                })
            }
        }

        next()
    } catch (err) {
        next(err)
    }
}

// --- Shared library: receiving jobs (VM only) --------------------------------

/************************************************************************/
/*!
  \brief
    Refuses new library jobs when the VM's disk is nearly full, before any
    upload is written.
  \return
    507 if free space is below config.minFreeDiskGB
*/
/************************************************************************/
export async function requireFreeDisk(_req, res, next)
{
  try
  {
    const stats = await fs.promises.statfs(config.jobsDir)
    const freeGB = (stats.bavail * stats.bsize) / 1024 ** 3
    if (freeGB < config.minFreeDiskGB)
    {
      console.warn(`[backend] library: refused job, only ${freeGB.toFixed(1)} GB free`)
      return res.status(507).json({ error: `The VM is low on disk space (${freeGB.toFixed(1)} GB free).` })
    }
    next()
  }
  catch (err)
  {
    next(err)
  }
}

/************************************************************************/
/*!
  \brief
    Checks the job id and makes the hidden staging folder the upload is
    written into (req.storeDir), laid out as <id>/images/ and <id>_out/.
  \return
    404 for an invalid id
*/
/************************************************************************/
export function prepareStore(req, res, next)
{
  const { id } = req.params
  if (!JOB_ID_RE.test(id) || id.endsWith('_out')) return res.status(404).json({ error: 'job not found' })
  req.storeDir = path.join(config.jobsDir, `.incoming-${crypto.randomUUID()}`)
  fs.mkdirSync(path.join(req.storeDir, id, 'images'), { recursive: true })
  fs.mkdirSync(path.join(req.storeDir, `${id}_out`), { recursive: true })
  next()
}

// Photos keep the client's names (0000.jpg, ...) so their URLs stay the same;
// the model, metrics and cover get fixed names. Anything else is dropped.
const STORE_FILE_NAMES = { result: 'result.ply', metrics: 'metrics.json', cover: 'cover.webp' }
export const storeUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) =>
      cb(null, file.fieldname === 'images'
        ? path.join(req.storeDir, req.params.id, 'images')
        : path.join(req.storeDir, `${req.params.id}_out`)),
    filename: (_req, file, cb) =>
      cb(null, file.fieldname === 'images' ? file.originalname : STORE_FILE_NAMES[file.fieldname]),
  }),
  limits: { fileSize: config.maxResultSizeMB * 1024 * 1024, files: config.maxFiles + 3 },
  fileFilter: (_req, file, cb) => cb(null,
    file.fieldname === 'images'
      ? /^[\w.-]+$/.test(file.originalname) && IMAGE_EXT_RE.test(file.originalname)
      : Object.hasOwn(STORE_FILE_NAMES, file.fieldname)),
})

/************************************************************************/
/*!
  \brief
    Reads the first bytes of a file (to check what it really is).
  \param filePath
  string
  \param count
  number
  \return
    Buffer of up to count bytes
*/
/************************************************************************/
export async function readFileHead(filePath, count)
{
  const handle = await fs.promises.open(filePath)
  try
  {
    const head = Buffer.alloc(count)
    const { bytesRead } = await handle.read(head, 0, count, 0)
    return head.subarray(0, bytesRead)
  }
  finally
  {
    await handle.close()
  }
}
