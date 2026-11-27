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

// Loading a model briefly needs about three times its file size (the download,
// its copy in WebAssembly memory and the decoded splats). Phones close a tab
// that uses too much, so above this size they are asked first. With
// navigator.deviceMemory (Chrome on Android) the limit follows the phone's RAM:
// 40 MB per GB, e.g. 160 MB on a 4 GB phone.
const PHONE_MODEL_WARN_BYTES = 150 * 1024 ** 2

// A phone or tablet, or any device that says it has little memory.
function isLowMemoryDevice() {
    const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false
    const isMobile = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    const memoryGB = navigator.deviceMemory
    return (isTouch && isMobile) || (Number.isFinite(memoryGB) && memoryGB <= 4)
}

function largeModelLimitBytes() {
    const memoryGB = navigator.deviceMemory
    return Number.isFinite(memoryGB) ? memoryGB * 40 * 1024 ** 2 : PHONE_MODEL_WARN_BYTES
}

function formatMB(bytes) {
    return `${Math.round(bytes / 1024 ** 2).toLocaleString()} MB`
}

// The browser ran out of memory (wasm abort, a RangeError from a huge buffer).
function isOutOfMemory(err) {
    const text = `${err?.name ?? ''} ${err?.message ?? ''}`
    return err instanceof RangeError || /out of memory|\bOOM\b|Aborted\(|Not enough memory/i.test(text)
}

/**
 * Download url with progress callbacks (0..1, or null if the size is unknown).
 * Returns the body as a list of chunks so it can be copied straight into wasm
 * memory without first joining it into one large JS buffer. confirmSize(bytes),
 * if given, is asked once the size is known and before the body is read;
 * resolving false stops the download (returns null).
 */
async function downloadChunks(url, signal, onProgress, confirmSize) {
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
    const total = Number(res.headers.get('Content-Length')) || 0
    if (confirmSize && total > 0 && !(await confirmSize(total))) {
        res.body?.cancel().catch(() => { })
        return null
    }
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
    // Bumped when the browser gives back a lost WebGL context: starts the engine again.
    const [contextRestoreCount, setContextRestoreCount] = useState(0)
    // Answers the "large model on a phone" question (status phase 'confirm').
    const confirmRef = useRef(null)
    // The user chose "Load anyway": don't ask again for this viewer.
    const largeModelOkRef = useRef(false)
    // Bumped by "Load anyway" after "Not now": runs the effect again.
    const [retryCount, setRetryCount] = useState(0)

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
        let contextLost = false // the GPU took the WebGL context away (see onContextLost)

        const frame = () => {
            if (contextLost) return
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

        // The GPU can take the WebGL context away (driver reset, GPU switch,
        // too many contexts, a phone backgrounding the tab). Without this the
        // view just goes black. preventDefault() asks for it back; once it is
        // restored the effect runs again and reloads the model.
        const onContextLost = (e) => {
            e.preventDefault()
            contextLost = true
            abort.abort() // a download in flight is restarted once the context is back
            cancelAnimationFrame(raf)
            if (!cancelled) setStatus({ phase: 'lost' })
        }
        const onContextRestored = () => {
            if (!cancelled) setContextRestoreCount((count) => count + 1)
        }
        canvas.addEventListener('webglcontextlost', onContextLost)
        canvas.addEventListener('webglcontextrestored', onContextRestored)

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
                    // On a phone, a large model is only loaded once the user agrees (see PHONE_MODEL_WARN_BYTES).
                    const confirmSize = isLowMemoryDevice() && !largeModelOkRef.current
                        ? (bytes) => {
                            if (bytes <= largeModelLimitBytes()) return true
                            return new Promise((resolve) => {
                                confirmRef.current = (ok) => {
                                    confirmRef.current = null
                                    if (ok) largeModelOkRef.current = true
                                    resolve(ok)
                                }
                                setStatus({ phase: 'confirm', bytes })
                            })
                        }
                        : null
                    const downloaded = await downloadChunks(url, abort.signal, (progress) => {
                        if (!cancelled && !contextLost) setStatus({ phase: 'download', progress })
                    }, confirmSize)
                    if (cancelled || contextLost) return
                    if (!downloaded) {
                        setStatus({ phase: 'declined' })
                        return
                    }
                    const { chunks } = downloaded

                    // Parsing blocks the main thread, so let the status paint first
                    setStatus({ phase: 'parse' })
                    await new Promise((resolve) => setTimeout(resolve, 30))
                    if (cancelled || contextLost) return
                    const name = url.split('/').filter(Boolean).slice(-2).join('/')
                    // The chunks go straight into wasm memory, without first joining them
                    // into one large buffer; throws if the engine can't read the file.
                    const count = engine.loadPly(chunks, name)
                    chunks.length = 0

                    dirty = true
                    if (!contextLost) setStatus({ phase: 'ready', count })
                } catch (err) {
                    if (cancelled || contextLost || err?.name === 'AbortError') return
                    console.error('Engine viewer failed:', err)
                    if (err instanceof EngineUnavailableError) {
                        onUnavailableRef.current?.(err.message)
                        return
                    }
                    if (isOutOfMemory(err)) {
                        setStatus({
                            phase: 'error',
                            message: 'This model is too large for this device\'s browser. Open it on a computer, or close other tabs and reload.',
                        })
                        return
                    }
                    setStatus({ phase: 'error', message: err?.message || String(err) })
                }
            })()

        return () => {
            cancelled = true
            confirmRef.current?.(false) // a question still open: let the download stop
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
            canvas.removeEventListener('webglcontextlost', onContextLost)
            canvas.removeEventListener('webglcontextrestored', onContextRestored)
            // Frees the GPU resources; safe if the engine already stopped.
            engine?.dispose()
        }
    }, [url, contextRestoreCount, retryCount])

    let message = null
    if (status.phase === 'engine') message = 'Starting engine…'
    else if (status.phase === 'download')
        message = status.progress == null ? 'Downloading model…' : `Downloading model… ${Math.round(status.progress * 100)}%`
    else if (status.phase === 'parse') message = 'Loading splats into the engine…'
    else if (status.phase === 'error') message = status.message
    else if (status.phase === 'lost')
        message = 'The graphics card reset, so the 3D view stopped. It should come back on its own; if not, reload the page.'

    // A large model on a phone: asked before it downloads (phase 'confirm'),
    // or left unloaded after "Not now" (phase 'declined').
    let questionText = null
    if (status.phase === 'confirm')
        questionText = `This model is ${formatMB(status.bytes)}. Models this large can make a phone close the page. Load it anyway?`
    else if (status.phase === 'declined')
        questionText = 'The model was not loaded. It opens best on a computer.'

    function loadLargeModel() {
        if (confirmRef.current) {
            confirmRef.current(true)
        } else {
            largeModelOkRef.current = true
            setRetryCount((count) => count + 1)
        }
    }

    function skipLargeModel() {
        confirmRef.current?.(false)
    }

    return (
        <>
            {questionText && (
                <div
                    className="genesis-overlay"
                    role="alertdialog"
                    style={{
                        position: overlayPosition,
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: 'min(360px, calc(100% - 32px))',
                        boxSizing: 'border-box',
                        padding: '16px 18px',
                        borderRadius: 8,
                        background: 'rgba(0, 0, 0, 0.75)',
                        color: '#f4fbfd',
                        textAlign: 'center',
                        zIndex: 11,
                    }}
                >
                    <p style={{ margin: '0 0 12px' }}>{questionText}</p>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                        <button className="btn btn-primary" onClick={loadLargeModel}>Load anyway</button>
                        {status.phase === 'confirm' && <button className="btn btn-ghost" onClick={skipLargeModel}>Not now</button>}
                    </div>
                </div>
            )}
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