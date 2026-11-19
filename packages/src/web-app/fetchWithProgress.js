/*!************************************************************************
\file fetchWithProgress.js
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 16-11-2026
\brief
Downloads a file while reporting how much has arrived. Shared by the .obj
export and .obj viewer workers.
- streamWithProgress(url, sizeHint, onChunk, onProgress)
Calls onChunk(Uint8Array) for every piece as it arrives and
onProgress(fraction) after each, using Content-Length or sizeHint for the
total (fraction is null when neither is known).
- fetchWithProgress(url, sizeHint, onProgress)
Same, but collects the whole file and returns it as one ArrayBuffer.
**************************************************************************/

export async function streamWithProgress(url, sizeHint, onChunk, onProgress) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Couldn't download the model (server returned ${res.status}).`)
    const total = Number(res.headers.get('Content-Length')) || Number(sizeHint) || 0
    const reader = res.body.getReader()
    let received = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.length
        onChunk(value)
        onProgress(total > 0 ? Math.min(received / total, 1) : null)
    }
    return received
}

export async function fetchWithProgress(url, sizeHint, onProgress) {
    const chunks = []
    const received = await streamWithProgress(url, sizeHint, (chunk) => chunks.push(chunk), onProgress)
    const bytes = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
    }
    return bytes.buffer
}
