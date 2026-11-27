# `backend/middleware/sendDbModel.js`

API layer: sends a model **stored in the database** (`FILE_STORE=db`, VM only) the way `res.sendFile` would send a file.

## `waitForDrain(res)` *(private)*
Promise that resolves on the response's `drain` or `close` event, whichever comes first. It removes both listeners afterwards.

## `sendDbModel(req, res, jobId, info)`
`info = { size, chunkSize, storedAt }` comes from `getDbModelInfo`.
1. Headers: `Content-Type: application/octet-stream`, `Accept-Ranges: bytes`, **`ETag: "<id>-<size>-<storedAt>"`**, `Cache-Control: private, no-cache`. If `req.fresh` (the ETag matches `If-None-Match`), it replies **304**.
2. **Ranges:** the `Range` header is honoured only if there is no `If-Range`, or `If-Range` equals the ETag. It uses `req.range(size, { combine: true })`:
   - `-1` (cannot be satisfied) gives **416** with `Content-Range: bytes */size`;
   - **a single byte range** gives **206** with `Content-Range: bytes start-end/size`. The viewer first reads bytes 0–4095;
   - a malformed range or several ranges get the whole file, as `sendFile` does.
3. Sets `Content-Length`. HEAD requests and empty ranges end here.
4. Streams **only the chunks the range covers**, one at a time (`readDbModelChunk(jobId, seq)`), sending the slice of each chunk that falls inside the range. When `res.write` returns false it **waits for `drain`**, so a slow client never causes the whole model to sit in memory. It stops if the client disconnects. A missing chunk (the job was deleted during the send) is logged and the response is destroyed.
