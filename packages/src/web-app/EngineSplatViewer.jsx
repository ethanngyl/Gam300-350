/*!************************************************************************
\file EngineSplatViewer.jsx
\author Ethan Ng Yong Le
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Shows a Gaussian splat .ply full-screen using the Codefine engine's own
renderer, compiled to WebAssembly from engine/src and installed as the
@codefine/splat-renderer package (engine/web/package). The engine draws into
a WebGL2 canvas; this component owns the canvas, the input events, the .ply
download and the render loop.
- EngineSplatViewer({ url, onUnavailable, isEmbedded })
React component. Loads the engine, downloads the .ply at url into it and
renders it. Calls onUnavailable(reason) if the engine or WebGL2 cannot start,
so the caller can fall back to another viewer. isEmbedded draws it inside
its parent (position: relative) instead of over the whole page.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { useEffect, useRef, useState } from 'react'
import { createSplatRenderer, EngineUnavailableError, RenderMode } from '@codefine/splat-renderer'

const RENDER_MODE = { pointCloud: RenderMode.PointCloud, gaussian: RenderMode.Gaussian }

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
    for (; ;) {
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
 * @param {string}   url            URL to the .ply (e.g. "/api/v1/jobs/<id>/result.ply").
 * @param {function} onUnavailable  Called with a reason if the engine can't run here.
 */
export default function EngineSplatViewer({ url, onUnavailable, isEmbedded = false }) {
    // Over the whole page, or filling the parent element when embedded.
    const overlayPosition = isEmbedded ? 'absolute' : 'fixed'
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

        const abort = new AbortController()
        let cancelled = false
        let engine = null // the SplatRenderer once it has started
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
            engine.render(w, h)
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
                if (prev.pan || e.shiftKey) engine.pan(dx, dy)
                else engine.orbit(dx, dy)
            } else if (pointers.size === 2 && pinch) {
                const next = twoFingerState()
                if (pinch.dist > 0 && next.dist > 0) engine.zoom(Math.log(next.dist / pinch.dist) * 5)
                engine.pan(next.midX - pinch.midX, next.midY - pinch.midY)
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
            engine.zoom(Math.max(-2, Math.min(2, notches)))
            dirty = true
        }

        const onDoubleClick = () => {
            if (!engine) return
            engine.resetCamera()
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

            ; (async () => {
                try {
                    // Rejects with EngineUnavailableError if the engine isn't built or WebGL2 is missing.
                    const renderer = await createSplatRenderer(canvas)
                    if (cancelled) {
                        renderer.dispose()
                        return
                    }
                    engine = renderer
                    engine.setRenderMode(modeRef.current)
                    controlsRef.current = {
                        setMode: (m) => {
                            engine.setRenderMode(m)
                            dirty = true
                        },
                        resetCamera: () => {
                            engine.resetCamera()
                            dirty = true
                        },
                    }
                    raf = requestAnimationFrame(frame)

                    setStatus({ phase: 'download', progress: 0 })
                    const { chunks } = await downloadChunks(url, abort.signal, (progress) => {
                        if (!cancelled) setStatus({ phase: 'download', progress })
                    })
                    if (cancelled) return

                    // Parsing blocks the main thread, so let the status paint first
                    setStatus({ phase: 'parse' })
                    await new Promise((resolve) => setTimeout(resolve, 30))
                    if (cancelled) return
                    const name = url.split('/').filter(Boolean).slice(-2).join('/')
                    // The chunks go straight into wasm memory, without first joining them
                    // into one large buffer; throws if the engine can't read the file.
                    const count = engine.loadPly(chunks, name)
                    chunks.length = 0

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
            // Frees the GPU resources; safe if the engine already stopped.
            engine?.dispose()
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
                style={{
                    position: overlayPosition,
                    inset: 0,
                    width: isEmbedded ? '100%' : '100vw',
                    height: isEmbedded ? '100%' : '100vh',
                    display: 'block',
                    touchAction: 'none',
                }}
            />
            {message && (
                <div
                    className="genesis-overlay"
                    role="status"
                    style={{
                        position: overlayPosition,
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
                className="genesis-overlay engine-viewer-controls"
                style={{ position: overlayPosition, bottom: isEmbedded ? 12 : 16, right: isEmbedded ? 12 : 16, display: 'flex', gap: 8, alignItems: 'center', zIndex: 10 }}
            >
                {status.phase === 'ready' && (
                    <span className="engine-viewer-count" style={{ color: '#f4fbfd', fontSize: 13, opacity: 0.8, marginRight: 4 }}>
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