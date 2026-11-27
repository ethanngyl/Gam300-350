# `backend/middleware/errors.js`

API layer: the JSON replies for requests that go wrong. It is mounted **last** in `server.js`.

## `jsonNotFound(req, res)`
Answers **404** `{ error: "<METHOD> <path> is not part of this API." }` when no route and no built frontend file matched. The API therefore only ever replies with JSON, never Express's HTML 404 page.

## `jsonErrorHandler(err, req, res, next)`
Error handler with four parameters, which is how Express recognises it. Without it, multer's upload-limit errors and anything passed to `next(err)` would reach Express's default HTML 500 page, which the frontend cannot parse.
1. If headers were already sent, it calls `next(err)` and lets Express finish or abort the response.
2. **Clean-up:** removes `jobs/<req.jobId>`, the empty folder `assignJobId` made before multer ran, and `req.storeDir`, a staging folder from a rejected library upload.
3. `err.type === 'entity.too.large'` gives **413**: *"That photo is too large -- it must be under N KB."* for `/avatar`, otherwise *"That request is too large."*
4. `MulterError` (checked with `path.endsWith('/jobs/from-media')`, so it works with or without the `/api/v1` prefix):
   - `LIMIT_FILE_SIZE` gives **413** with the photo or media size limit from config;
   - `LIMIT_FILE_COUNT`, `LIMIT_PART_COUNT` and `LIMIT_UNEXPECTED_FILE` give **400** *"Too many files -- upload at most N…"*;
   - any other code gives 400 with the multer message.
5. Anything else is logged and gets **500** *"Something went wrong on the server. Please try again."*
