/*!************************************************************************
\file sendDbModel.js
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
API layer: sending a model stored in the database (FILE_STORE=db, VM only).
Moved out of server.js.
- sendDbModel(req, res, jobId, info)
Serves a model stored in the database, piece by piece, with byte ranges
(the viewer reads the first 4 KB), HEAD and ETag (304) like sendFile.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { readDbModelChunk } from '../db.js'

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Waits until a response can take more data, or the client has gone.
  \param res
    The response
  \return
    Promise that resolves on 'drain' or 'close'
*/
/************************************************************************/
function waitForDrain(res)
{
  return new Promise((resolve) =>
  {
    const done = () =>
    {
      res.off('drain', done)
      res.off('close', done)
      resolve()
    }
    res.on('drain', done)
    res.on('close', done)
  })
}

/************************************************************************/
/*!
  \brief
    Serves a model stored in the database the way sendFile serves a file:
    a single byte range (206; the viewer first reads bytes 0-4095), HEAD,
    and an ETag so an unchanged model answers 304. Only the pieces the
    range covers are read, one at a time, waiting whenever the client is
    slower than the database, so a whole model is never in memory.
  \param req
    The request
  \param res
    The response
  \param jobId
    string
  \param info
    { size, chunkSize, storedAt } from getDbModelInfo
  \return
    nothing; the response is sent (or destroyed if the model was deleted
    part-way through)
*/
/************************************************************************/
export async function sendDbModel(req, res, jobId, info)
{
  const etag = `"${jobId}-${info.size}-${info.storedAt}"`
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('ETag', etag)
  res.setHeader('Cache-Control', 'private, no-cache')
  if (req.fresh) return res.status(304).end()

  let start = 0
  let end = info.size - 1
  // If-Range: only honour the range if the client's copy is this model.
  const ifRange = req.headers['if-range']
  const ranges = req.headers.range && (!ifRange || ifRange === etag) ? req.range(info.size, { combine: true }) : undefined
  if (ranges === -1)
  {
    res.setHeader('Content-Range', `bytes */${info.size}`)
    return res.status(416).end()
  }
  // A single range is served as asked; a malformed one (-2) or several
  // ranges get the whole file, as sendFile does.
  if (Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length === 1)
  {
    start = ranges[0].start
    end = ranges[0].end
    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`)
  }
  res.setHeader('Content-Length', String(end - start + 1))
  if (req.method === 'HEAD' || end < start) return res.end()

  let clientGone = false
  res.on('close', () => { clientGone = true })
  try
  {
    for (let seq = Math.floor(start / info.chunkSize); seq * info.chunkSize <= end; seq++)
    {
      if (clientGone) return
      const chunk = readDbModelChunk(jobId, seq)
      if (!chunk) throw new Error(`piece ${seq} is missing (deleted while being sent?)`)
      const chunkStart = seq * info.chunkSize
      const piece = chunk.subarray(Math.max(0, start - chunkStart), Math.min(chunk.length, end - chunkStart + 1))
      if (!res.write(piece)) await waitForDrain(res)
    }
    res.end()
  }
  catch (err)
  {
    console.warn(`[backend] stopped sending the model of job ${jobId}: ${err.message}`)
    res.destroy()
  }
}
