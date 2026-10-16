/*!************************************************************************
\file EngineSplatViewer.jsx
\author Ethan Ng Yong Le
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Shows a Gaussian splat .ply full-screen using the Codefine engine's own
renderer, compiled to WebAssembly from engine/src (see engine/web and
engine/build-web.bat). The engine draws into a WebGL2 canvas; this component
owns the canvas, the input events, the .ply download and the render loop.
- EngineSplatViewer({ url, onUnavailable })
React component. Loads the engine, downloads the .ply at url into it and
renders it. Calls onUnavailable(reason) if the engine or WebGL2 cannot start,
so the caller can fall back to another viewer.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { useEffect, useRef, useState } from 'react'
import { loadEngineFactory } from './codefineEngine.js'

const RENDER_MODE = { pointCloud: 0, gaussian: 1 }

let canvasCounter = 0

class EngineUnavailableError extends Error {}

/**
 * Download url with progress callbacks (0..1, or null if the size is unknown).
 * Returns the body as a list of chunks so it can be copied straight into wasm
 * memory without first joining it into one large JS buffer.
 */
async function downloadChunks(url, signal, onProgress) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
  const total = Number(res.headers.get('Content-Length')) || 0
  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress(total ? received / total : null)
  }
  return { chunks, size: received }
}

/**
 * Renders a Gaussian splat .ply with the engine's renderer.
 *
 * @param {string}   url            URL to the .ply (e.g. "/jobs/<id>/result.ply").
 * @param {function} onUnavailable  Called with a reason if the engine can't run here.
 */
export default function EngineSplatViewer({ url, onUnavailable }) {
  const canvasRef = useRef(null)
  const controlsRef = useRef(null) // { setMode, resetCamera } once the engine is up
  const onUnavailableRef = useRef(onUnavailable)
  const [mode, setMode] = useState(RENDER_MODE.gaussian)
  const modeRef = useRef(mode)
  const [status, setStatus] = useState({ phase: 'engine' })

  useEffect(() => {
    onUnavailableRef.current = onUnavailable
  }, [onUnavailable])

  useEffect(() => {
    modeRef.current = mode
    controlsRef.current?.setMode(mode)
  }, [mode])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.id = `codefine-engine-${++canvasCounter}`

    const abort = new AbortController()
    let cancelled = false
    let engine = null
    let raf = 0
    let dirty = true // render on demand: only after input, resize or a load

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        dirty = true
      }
      if (!dirty) return
      dirty = false
      engine._cf_render(w, h)
    }

    // ----- Input: same camera as the editor, mapped for mouse + touch ----- //
    // Drag = orbit, right/middle/shift-drag = pan, wheel = zoom,
    // two fingers = pinch zoom + pan, double-click = reset view.
    const pointers = new Map()
    let pinch = null

    const twoFingerState = () => {
      const [a, b] = [...pointers.values()]
      return {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      }
    }

    const onPointerDown = (e) => {
      if (!engine) return
      canvas.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pan: e.button === 1 || e.button === 2 })
      pinch = pointers.size === 2 ? twoFingerState() : null
    }

    const onPointerMove = (e) => {
      const prev = pointers.get(e.pointerId)
      if (!engine || !prev) return
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      prev.x = e.clientX
      prev.y = e.clientY

      if (pointers.size === 1) {
        if (prev.pan || e.shiftKey) engine._cf_pan(dx, dy)
        else engine._cf_orbit(dx, dy)
      } else if (pointers.size === 2 && pinch) {
        const next = twoFingerState()
        if (pinch.dist > 0 && next.dist > 0) engine._cf_zoom(Math.log(next.dist / pinch.dist) * 5)
        engine._cf_pan(next.midX - pinch.midX, next.midY - pinch.midY)
        pinch = next
      }
      dirty = true
    }

    const onPointerUp = (e) => {
      pointers.delete(e.pointerId)
      pinch = pointers.size === 2 ? twoFingerState() : null
    }

    const onWheel = (e) => {
      if (!engine) return
      e.preventDefault()
      // The editor zooms one step per wheel notch; browsers report ~100px (or 3 lines) per notch
      const notches = -e.deltaY / (e.deltaMode === 1 ? 3 : 100)
      engine._cf_zoom(Math.max(-2, Math.min(2, notches)))
      dirty = true
    }

    const onDoubleClick = () => {
      if (!engine) return
      engine._cf_reset_camera()
      dirty = true
    }

    const onContextMenu = (e) => e.preventDefault()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDoubleClick)
    canvas.addEventListener('contextmenu', onContextMenu)

    ;(async () => {
      try {
        let createEngine
        try {
          createEngine = await loadEngineFactory()
        } catch {
          throw new EngineUnavailableError('The engine has not been built for the web (run engine/build-web.bat).')
        }
        const instance = await createEngine({ printErr: (msg) => console.warn('[Engine]', msg) })
        if (cancelled) return
        if (!instance.ccall('cf_init', 'number', ['string'], [`#${canvas.id}`])) {
          throw new EngineUnavailableError('This browser does not support WebGL2.')
        }
        engine = instance
        engine._cf_set_render_mode(modeRef.current)
        controlsRef.current = {
          setMode: (m) => {
            engine._cf_set_render_mode(m)
            dirty = true
          },
          resetCamera: () => {
            engine._cf_reset_camera()
            dirty = true
          },
        }
        raf = requestAnimationFrame(frame)

        setStatus({ phase: 'download', progress: 0 })
        const { chunks, size } = await downloadChunks(url, abort.signal, (progress) => {
          if (!cancelled) setStatus({ phase: 'download', progress })
        })
        if (cancelled) return

        // Copy into wasm memory. HEAPU8 is re-read after malloc because growing
        // the heap replaces the underlying ArrayBuffer.
        const ptr = engine._malloc(size) >>> 0
        if (!ptr) throw new Error('Not enough memory to load this model in the browser.')
        let offset = ptr
        for (const chunk of chunks) {
          engine.HEAPU8.set(chunk, offset)
          offset += chunk.length
        }
        chunks.length = 0

        // Parsing blocks the main thread, so let the status paint first
        setStatus({ phase: 'parse' })
        await new Promise((resolve) => setTimeout(resolve, 30))
        if (cancelled) {
          engine._free(ptr)
          return
        }
        const name = url.split('/').filter(Boolean).slice(-2).join('/')
        const count = engine.ccall('cf_load_ply', 'number', ['number', 'number', 'string'], [ptr, size, name])
        engine._free(ptr)
        if (count <= 0) throw new Error('The engine could not read this .ply (see the browser console).')

        dirty = true
        setStatus({ phase: 'ready', count })
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') return
        console.error('Engine viewer failed:', err)
        if (err instanceof EngineUnavailableError) {
          onUnavailableRef.current?.(err.message)
          return
        }
        setStatus({ phase: 'error', message: err?.message || String(err) })
      }
    })()

    return () => {
      cancelled = true
      abort.abort()
      cancelAnimationFrame(raf)
      controlsRef.current = null
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dblclick', onDoubleClick)
      canvas.removeEventListener('contextmenu', onContextMenu)
      if (engine) {
        try {
          engine._cf_shutdown()
        } catch {
          /* module already aborted (e.g. out of memory) */
        }
      }
    }
  }, [url])

  let message = null
  if (status.phase === 'engine') message = 'Starting engine…'
  else if (status.phase === 'download')
    message = status.progress == null ? 'Downloading model…' : `Downloading model… ${Math.round(status.progress * 100)}%`
  else if (status.phase === 'parse') message = 'Loading splats into the engine…'
  else if (status.phase === 'error') message = status.message

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', display: 'block', touchAction: 'none' }}
      />
      {message && (
        <div
          className="genesis-overlay"
          role="status"
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '12px 18px',
            borderRadius: 8,
            background: 'rgba(0, 0, 0, 0.6)',
            color: status.phase === 'error' ? '#ff9b9b' : '#f4fbfd',
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          {message}
        </div>
      )}
      <div
        className="genesis-overlay"
        style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', gap: 8, alignItems: 'center', zIndex: 10 }}
      >
        {status.phase === 'ready' && (
          <span style={{ color: '#f4fbfd', fontSize: 13, opacity: 0.8, marginRight: 4 }}>
            {status.count.toLocaleString()} splats
          </span>
        )}
        <button
          className={`btn ${mode === RENDER_MODE.gaussian ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMode(RENDER_MODE.gaussian)}
        >
          Gaussian
        </button>
        <button
          className={`btn ${mode === RENDER_MODE.pointCloud ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMode(RENDER_MODE.pointCloud)}
        >
          Point cloud
        </button>
        <button className="btn btn-ghost" onClick={() => controlsRef.current?.resetCamera()}>
          Reset view
        </button>
      </div>
    </>
  )
}
