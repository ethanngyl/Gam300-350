import { useEffect, useRef } from 'react'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'

/**
 * Read the scene's "up" direction from a Brush-exported .ply header.
 * Brush writes a `comment Vertical axis: x y z` line; using it orients arbitrary
 * scenes upright instead of tilted. Falls back to +Y if not found.
 * Only the first few KB are fetched (HTTP Range), so this is cheap.
 */
async function readCameraUp(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-4095' } })
    const text = await res.text()
    const m = text.match(/Vertical axis:\s*([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)/)
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  } catch {
    /* ignore — use default */
  }
  return [0, 1, 0]
}

/**
 * Renders a 3D Gaussian Splatting scene (a Brush .ply) in the browser via
 * @mkkellogg/gaussian-splats-3d, which handles WebGL splat rendering, per-frame
 * depth sorting, and orbit camera controls.
 *
 * @param {string} url  URL to the .ply (e.g. "/api/jobs/<id>/result.ply").
 */
export default function SplatViewer({ url }) {
  const containerRef = useRef(null)
  const viewerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false

    ;(async () => {
      const cameraUp = await readCameraUp(url)
      if (disposed) return

      const viewer = new GaussianSplats3D.Viewer({
        rootElement: container,
        cameraUp,
        initialCameraPosition: [-3, 1, 5],
        initialCameraLookAt: [0, 0, 0],
        // Plain worker (no SharedArrayBuffer) => no COOP/COEP headers needed in dev.
        sharedMemoryForWorkers: false,
      })
      viewerRef.current = viewer

      try {
        await viewer.addSplatScene(url, {
          splatAlphaRemovalThreshold: 5,
          showLoadingUI: true,
        })
        if (!disposed) viewer.start()
      } catch (err) {
        console.error('Failed to load splat scene:', err)
      }
    })()

    return () => {
      disposed = true
      const v = viewerRef.current
      viewerRef.current = null
      if (v) {
        try {
          v.stop?.()
        } catch {
          /* not started */
        }
        v.dispose?.()
      }
    }
  }, [url])

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}
    />
  )
}
