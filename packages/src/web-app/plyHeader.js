/*!************************************************************************
\file plyHeader.js
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 26-10-2026
\brief
Reads metadata from the header of a Brush-exported Gaussian splat .ply
without downloading the whole file.
- readCameraUp(url)
Fetches only the first 4 KB of the .ply (HTTP Range) and reads the
"Vertical axis" line Brush writes into the header. Returns it as
[x, y, z], or [0, 1, 0] (+Y) if it can't be found.
- readPlyInfo(url)
Same 4 KB read; returns { splatCount, fileSizeBytes } for the model page
(the "element vertex" count and the size from Content-Range). Either is
null if it can't be found.
- checkSplatPly(url)
Same 4 KB read, for the Scene Builder before it downloads a whole model.
Returns { up, problem }: up as for readCameraUp, and problem null if the
file looks loadable, else a sentence saying why it can't be loaded
(signed out, not found, server error, not a gaussian splat .ply, ...).
**************************************************************************/

const HEADER_BYTES = 4096

// Reads up to HEADER_BYTES of a response body as text. Blob URLs (a .ply
// opened from disk) may ignore Range, so stop after that many bytes
// instead of pulling in the whole file.
async function readHeaderText(res) {
    const reader = res.body.getReader()
    const chunks = []
    let received = 0
    while (received < HEADER_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
    }
    reader.cancel().catch(() => { })
    return new TextDecoder().decode(await new Blob(chunks).arrayBuffer())
}

function parseCameraUp(headerText) {
    const m = headerText.match(/Vertical axis:\s*([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)/)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// What to tell the user for a refused download. The backend's 404s say
// 'job not found' (gone, or another account's) or 'result not ready'.
async function describeHttpProblem(res) {
    let serverMessage = ''
    try {
        serverMessage = String((await res.json())?.error ?? '')
    } catch {
        /* not JSON */
    }
    if (res.status === 401) return 'You are signed out. Sign in again to load this model.'
    if (res.status === 403) return "You don't have access to this model."
    if (res.status === 404) {
        return /not ready/i.test(serverMessage)
            ? "This model's file is missing or it hasn't finished building."
            : 'This model was deleted or belongs to another account.'
    }
    if (res.status === 429) return 'Too many downloads at once. Wait a moment, then reload the scene.'
    if (res.status === 502 || res.status === 504) return "Couldn't reach the server that stores this model. Try again later."
    if (res.status >= 500) return `The server couldn't send this model (error ${res.status}). Try again later.`
    return `Couldn't download this model (error ${res.status}).`
}

// Why a .ply header can't be read as a gaussian splat, or null if it can.
// Matches what @mkkellogg/gaussian-splats-3d's PLY loader accepts.
function describeFormatProblem(headerText) {
    if (!headerText.startsWith('ply')) return "This file isn't a .ply model."
    const format = headerText.match(/^format\s+(\S+)/m)?.[1]
    if (format && format !== 'binary_little_endian') {
        return `This .ply is saved as ${format === 'ascii' ? 'text (ASCII)' : format}, which the viewer can't read.`
    }
    if (!headerText.includes('end_header')) return null // header longer than we read; let the loader decide
    if (/^element chunk\b/m.test(headerText)) return null // compressed splat layout
    const vertexCount = Number(headerText.match(/^element vertex\s+(\d+)/m)?.[1] ?? 0)
    if (vertexCount === 0) return 'This model file is empty.'
    const properties = new Set([...headerText.matchAll(/^property\s+\S+\s+(\S+)/gm)].map((match) => match[1]))
    const isSplat = ['scale_0', 'rot_0', 'opacity'].every((name) => properties.has(name)) &&
        (properties.has('f_dc_0') || properties.has('red'))
    return isSplat ? null : 'This .ply is a plain point cloud, not a gaussian splat model.'
}

/**
 * Check a model's .ply before the Scene Builder downloads all of it, and
 * read its "up" direction on the way. problem is null if it looks loadable.
 */
export async function checkSplatPly(url) {
    let res
    try {
        res = await fetch(url, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` } })
    } catch {
        return { up: [0, 1, 0], problem: "Couldn't reach the server. Check your connection and try again." }
    }
    if (!res.ok) return { up: [0, 1, 0], problem: await describeHttpProblem(res) }
    try {
        const headerText = await readHeaderText(res)
        return { up: parseCameraUp(headerText) ?? [0, 1, 0], problem: describeFormatProblem(headerText) }
    } catch {
        return { up: [0, 1, 0], problem: 'The download was interrupted. Try again.' }
    }
}

/**
 * Read the scene's "up" direction from a Brush-exported .ply header so arbitrary
 * scenes render upright. Only the first few KB are fetched (HTTP Range).
 * Falls back to +Y if not found.
 */
export async function readCameraUp(url) {
    try {
        const res = await fetch(url, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` } })
        const up = parseCameraUp(await readHeaderText(res))
        if (up) return up
    } catch {
        /* ignore — use default */
    }
    return [0, 1, 0]
}

/**
 * Read a .ply's splat count (header "element vertex N") and file size
 * (Content-Range "bytes 0-4095/<size>") from its first 4 KB.
 */
export async function readPlyInfo(url) {
    const info = { splatCount: null, fileSizeBytes: null }
    try {
        const res = await fetch(url, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` } })
        if (!res.ok) return info
        const totalFromRange = Number(res.headers.get('Content-Range')?.split('/')[1])
        if (totalFromRange > 0) info.fileSizeBytes = totalFromRange
        const text = await readHeaderText(res)
        const match = text.match(/element vertex\s+(\d+)/)
        if (match) info.splatCount = Number(match[1])
    } catch {
        /* ignore: the model page just leaves these out */
    }
    return info
}