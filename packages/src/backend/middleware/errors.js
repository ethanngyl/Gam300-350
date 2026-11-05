/*!************************************************************************
\file errors.js
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
API layer: the JSON replies for requests that go wrong, mounted last in
server.js. Moved out of server.js.
- jsonNotFound(req, res)
404 { error } for a path no route or built frontend file answers, instead
of Express's default HTML page.
- jsonErrorHandler(err, req, res, next)
Turns upload-limit errors and any error passed to next(err) into a JSON
{ error } with the right status, and removes the folder a rejected upload
was being written into.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import { config } from '../config.js'

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Answers a request no route (and no built frontend file) matched, so
    the API only ever replies with JSON, never Express's HTML 404 page.
  \param req
    The request
  \param res
    The response
  \return
    404 { error }
*/
/************************************************************************/
export function jsonNotFound(req, res) {
    res.status(404).json({ error: `${req.method} ${req.path} is not part of this API.` })
}

/************************************************************************/
/*!
  \brief
    JSON error handler (must be last, and take 4 args so Express treats it
    as an error handler). Without it, multer's upload-limit errors and any
    error passed to next(err) fall through to Express's default handler,
    which replies with an HTML 500 -- the frontend does res.json() on that
    and can only show a generic message. Here each case becomes a JSON
    { error } with the right status, so the upload UI can show something
    useful ("that file is too big"), and the job folder assignJobId created
    up front is cleaned up so a rejected upload leaves nothing behind.
  \param err
    The error passed on from a route or from multer.
  \param req
    The request (carries req.jobId for the folder cleanup).
  \param res
    The response.
  \param _next
    Express's next (unused, but required for the 4-arg signature).
  \return
    Sends a JSON error response; delegates to Express if a reply already
    started streaming.
*/
/************************************************************************/
export function jsonErrorHandler(err, req, res, _next) {
    // A partial reply is already on the wire -- let Express finish/abort it.
    if (res.headersSent) return _next(err)

  // Clean up the empty job folder assignJobId made before multer ran, so a
  // rejected upload doesn't leave a stray folder that scanJobs would skip
  // anyway (no images) but that still clutters jobs/. Best-effort.
  if (req.jobId) {
    try {
      fs.rmSync(path.join(config.jobsDir, req.jobId), { recursive: true, force: true })
    } catch {
      // Nothing to clean up, or it's already gone.
    }
  }
  // Same for a shared-library upload rejected part-way (see prepareStore).
  if (req.storeDir) {
    try {
      fs.rmSync(req.storeDir, { recursive: true, force: true })
    } catch {
      // Already gone.
    }
  }

    // A body over its parser's size limit, e.g. a profile photo over config.maxAvatarKB.
    if (err.type === 'entity.too.large') {
        return res.status(413).json({
            error: req.path.endsWith('/avatar')
                ? `That photo is too large -- it must be under ${config.maxAvatarKB} KB.`
                : 'That request is too large.',
        })
    }

    if (err instanceof multer.MulterError) {
        // The limits come from config (maxFileSizeMB, maxFiles, and the media
        // versions); keep the messages in sync with those so they stay true if
        // the limits change.
        // endsWith: this runs on the app, where the path still has its
        // /api/v1 prefix (or none, on the legacy path).
        const isMediaUpload = req.path.endsWith('/jobs/from-media')
        switch (err.code) {
            case 'LIMIT_FILE_SIZE':
                return res.status(413).json({
                    error: isMediaUpload
                        ? `That file is too large -- each file must be under ${config.maxMediaSizeMB} MB.`
                        : `That file is too large -- each photo must be under ${config.maxFileSizeMB} MB.`,
                })
            case 'LIMIT_FILE_COUNT':
            case 'LIMIT_PART_COUNT':
            case 'LIMIT_UNEXPECTED_FILE':
                return res.status(400).json({
                    error: isMediaUpload
                        ? `Too many files -- upload at most ${config.maxMediaFiles} files at once.`
                        : `Too many files -- upload at most ${config.maxFiles} photos at once.`,
                })
            default:
                return res.status(400).json({ error: `Upload rejected: ${err.message}.` })
        }
    }

    // Anything else (e.g. onlyImages' fs failure) is a real server-side fault.
    console.error('[backend] request error:', err)
    res.status(500).json({ error: 'Something went wrong on the server. Please try again.' })
}
