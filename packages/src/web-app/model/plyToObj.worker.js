/*!************************************************************************
\file plyToObj.worker.js
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 16-11-2026
\brief
Web Worker that downloads a Gaussian splat .ply and converts it to .obj
(plyToObj.js), off the page's main thread. Mesh exports come with a .mtl
and a colour texture, so all three are bundled into one .zip (zipStore.js).
In:  { url, sizeHint, options, fileStem }  (url absolute, or a blob: URL)
Out: { type: 'progress', stage: 'download' | 'convert', fraction }
     { type: 'done', blob, fileName, splatCount, vertexCount, triangleCount }
     { type: 'error', message }
**************************************************************************/

import { convertPlyToObj, safeFileStem } from './plyToObj.js'
import { zipStored } from './zipStore.js'
import { fetchWithProgress } from './fetchWithProgress.js'

self.onmessage = async (event) => {
    const { url, sizeHint, options, fileStem } = event.data
    const stem = safeFileStem(fileStem)
    try {
        const buffer = await fetchWithProgress(url, sizeHint, (fraction) => {
            self.postMessage({ type: 'progress', stage: 'download', fraction })
        })
        let lastSent = -1
        const result = convertPlyToObj(buffer, { ...options, fileStem: stem }, (fraction) => {
            // Roughly every percent is plenty.
            if (fraction - lastSent >= 0.01 || fraction === 1) {
                lastSent = fraction
                self.postMessage({ type: 'progress', stage: 'convert', fraction })
            }
        })
        let blob
        let fileName
        if (result.material) {
            // The .obj names its .mtl and texture, so they have to stay together.
            const encoder = new TextEncoder()
            const { mtlFile, mtlText, pngFile, png } = result.material
            blob = zipStored([
                { name: stem + '.obj', data: result.parts.map((part) => encoder.encode(part)) },
                { name: mtlFile, data: encoder.encode(mtlText) },
                { name: pngFile, data: png },
            ])
            fileName = stem + '.zip'
        } else {
            blob = new Blob(result.parts, { type: 'model/obj' })
            fileName = stem + '.obj'
        }
        self.postMessage({
            type: 'done',
            blob,
            fileName,
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
