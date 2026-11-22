/*!************************************************************************
\file objParser.worker.js
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 16-11-2026
\brief
Web Worker that downloads and parses a .obj for the .obj viewer
(objParser.js), off the page's main thread. Parsing happens as the file
streams in.
In:  { url, sizeHint }  (url absolute, or a blob: URL)
Out: { type: 'progress', fraction }
     { type: 'done', positions, colors, indices, vertexCount, triangleCount }
       (the typed arrays are transferred)
     { type: 'error', message }
**************************************************************************/

import { createObjParser } from './objParser.js'
import { streamWithProgress } from './fetchWithProgress.js'

self.onmessage = async (event) => {
    const { url, sizeHint } = event.data
    try {
        const parser = createObjParser()
        const decoder = new TextDecoder()
        let lastSent = -1
        await streamWithProgress(
            url,
            sizeHint,
            (chunk) => parser.push(decoder.decode(chunk, { stream: true })),
            (fraction) => {
                if (fraction == null || fraction - lastSent >= 0.01 || fraction === 1) {
                    lastSent = fraction ?? lastSent
                    self.postMessage({ type: 'progress', fraction })
                }
            },
        )
        parser.push(decoder.decode())
        const result = parser.finish()
        if (result.vertexCount === 0) throw new Error('This .obj has no vertices.')
        const transfer = [result.positions.buffer]
        if (result.colors) transfer.push(result.colors.buffer)
        if (result.indices) transfer.push(result.indices.buffer)
        self.postMessage({ type: 'done', ...result }, transfer)
    } catch (err) {
        const message = err instanceof RangeError ? 'This .obj is too large to view in the browser.' : err.message
        self.postMessage({ type: 'error', message })
    }
}
