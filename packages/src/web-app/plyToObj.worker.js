/*!************************************************************************
\file plyToObj.worker.js
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 16-11-2026
\brief
Web Worker that downloads a Gaussian splat .ply and converts it to .obj
(plyToObj.js), off the page's main thread.
In:  { url, sizeHint, options }  (url absolute, or a blob: URL)
Out: { type: 'progress', stage: 'download' | 'convert', fraction }
     { type: 'done', blob, splatCount, vertexCount, triangleCount }
     { type: 'error', message }
**************************************************************************/

import { convertPlyToObj } from './plyToObj.js'
import { fetchWithProgress } from './fetchWithProgress.js'

self.onmessage = async (event) => {
    const { url, sizeHint, options } = event.data
    try {
        const buffer = await fetchWithProgress(url, sizeHint, (fraction) => {
            self.postMessage({ type: 'progress', stage: 'download', fraction })
        })
        let lastSent = -1
        const result = convertPlyToObj(buffer, options, (fraction) => {
            // Roughly every percent is plenty.
            if (fraction - lastSent >= 0.01 || fraction === 1) {
                lastSent = fraction
                self.postMessage({ type: 'progress', stage: 'convert', fraction })
            }
        })
        const blob = new Blob(result.parts, { type: 'model/obj' })
        self.postMessage({
            type: 'done',
            blob,
            splatCount: result.splatCount,
            vertexCount: result.vertexCount,
            triangleCount: result.triangleCount,
        })
    } catch (err) {
        const message = err instanceof RangeError
            ? 'The model is too large to convert in the browser. Raise the minimum opacity, use low mesh detail, or export points instead.'
            : err.message
        self.postMessage({ type: 'error', message })
    }
}
