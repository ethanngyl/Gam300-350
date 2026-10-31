/*!************************************************************************
\file SplatViewer.jsx
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 02-10-2026
\brief
Shows a finished Gaussian splat .ply full-screen in the browser. By default
it uses the Codefine engine's own renderer compiled to WebAssembly (see
EngineSplatViewer.jsx). If that is unavailable, or the user switches to it,
it uses @mkkellogg/gaussian-splats-3d for the WebGL rendering, depth sorting
and orbit controls, reading the scene's up direction from the .ply header so
any scene renders upright (readCameraUp, see plyHeader.js).
- ThreeSplatViewer({ url })
Private component. Creates the @mkkellogg viewer, loads the .ply at url and
starts rendering. Stops and disposes the viewer when url changes or the
component unmounts.
- SplatViewer({ url })
React component. Picks the engine or the three.js viewer and shows a toggle
to switch between them; the choice is remembered per browser.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { useCallback, useEffect, useRef, useState } from 'react'
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'
import EngineSplatViewer from './EngineSplatViewer.jsx'
import { isEngineAvailable } from './codefineEngine.js'
import { readCameraUp } from './plyHeader.js'

const RENDERER_PREF_KEY = 'genesis.splatRenderer'

function readRendererPref() {
  try {
    return localStorage.getItem(RENDERER_PREF_KEY) === 'three' ? 'three' : 'engine'
  } catch {
    return 'engine'
  }
}

function writeRendererPref(renderer) {
  try {
    localStorage.setItem(RENDERER_PREF_KEY, renderer)
  } catch {
    /* storage blocked, the choice just isn't remembered */
  }
}

/**
 * Renders a Gaussian splat .ply in the browser via @mkkellogg/gaussian-splats-3d,
 * which handles WebGL splat rendering, depth sorting, and orbit controls.
 *
 * @param {string} url  URL to the .ply (e.g. "/jobs/<id>/result.ply").
 */
function ThreeSplatViewer({ url }) {
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
        sharedMemoryForWorkers: false, // no COOP/COEP headers needed in dev
      })
      viewerRef.current = viewer

      try {
        await viewer.addSplatScene(url, {
          format: GaussianSplats3D.SceneFormat.Ply, // blob URLs have no extension to infer it from
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

/**
 * Full-page splat viewer. Uses the engine renderer when it is available and
 * falls back to the three.js viewer otherwise.
 *
 * @param {string} url  URL to the .ply (e.g. "/jobs/<id>/result.ply").
 */
export default function SplatViewer({ url }) {
  const [renderer, setRenderer] = useState(readRendererPref)
  const [engineAvailable, setEngineAvailable] = useState(null) // null = still checking
  const [engineNotice, setEngineNotice] = useState(null)

  useEffect(() => {
    let cancelled = false
    isEngineAvailable().then((ok) => {
      if (cancelled) return
      setEngineAvailable(ok)
      if (!ok) setEngineNotice('Engine renderer not built (run engine/build-web.bat)')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleEngineUnavailable = useCallback((reason) => {
    console.warn('Engine renderer unavailable, using three.js viewer:', reason)
    setEngineAvailable(false)
    setEngineNotice(reason)
  }, [])

  const choose = (next) => {
    setRenderer(next)
    writeRendererPref(next)
  }

  // Wait for the availability check so the 300+ MB .ply isn't fetched by both viewers
  if (engineAvailable === null) return null

  const active = renderer === 'engine' && engineAvailable ? 'engine' : 'three'

  return (
    <>
      {active === 'engine' ? (
        <EngineSplatViewer url={url} onUnavailable={handleEngineUnavailable} />
      ) : (
        <ThreeSplatViewer url={url} />
      )}
      <div
        className="genesis-overlay"
        style={{ position: 'fixed', bottom: 16, left: 16, display: 'flex', gap: 8, alignItems: 'center', zIndex: 10 }}
      >
        <button
          className={`btn ${active === 'engine' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => choose('engine')}
          disabled={!engineAvailable}
          title={engineAvailable ? 'Render with the Genesis Alpha Build engine (WebAssembly)' : engineNotice ?? undefined}
        >
          Engine renderer
        </button>
        <button
          className={`btn ${active === 'three' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => choose('three')}
        >
          Three.js renderer
        </button>
      </div>
    </>
  )
}
