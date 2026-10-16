/*!************************************************************************
\file Processing.jsx
\author Xiong Yang
\par DP email1: xiong.yang@digipen.edu
\par DP email2: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 09-10-2026
\brief
\brief
The screen shown while the backend reconstructs a job. It polls the server
for the job's phase and progress, shows a progress bar with a friendly label,
and hands off to the viewer once the splat is ready. Leaving the screen in
any way (Cancel, closing the tab, refreshing, Back) tells the server to kill
the job so COLMAP/Brush don't keep running on the GPU for nobody.
- PHASE_LABELS
Maps the backend's phase names to the labels shown to the user.
- Processing({ jobId, onDone, onCancel })
React component. Polls /jobs/:id every 1.5s until the job is done, failed or
cancelled. Calls onDone() when the splat is ready and onCancel() when the
user leaves. Shows an error message with tips if the reconstruction fails.
- killJob()
Inner helper. Sends DELETE /jobs/:id (keepalive) on pagehide or unmount,
unless the job already finished so its result stays downloadable.
- cancel()
Inner helper. Kills the server-side job, then calls onCancel().
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { useEffect, useRef, useState } from 'react'
import './Processing.css'

// Friendly labels for the backend's phase names.
const PHASE_LABELS = {
    upload: 'Uploading photos',
    'colmap-features': 'Analyzing photos',
    'colmap-matching': 'Matching photos',
    'colmap-mapping': 'Recovering camera positions',
    training: 'Training 3D model',
    normalize: 'Finalizing model',
    done: 'Done',
}

// Order the backend moves through the phases, used only to draw the step
// tracker (display only, does not affect the job).
const PHASE_ORDER = [
    'upload',
    'colmap-features',
    'colmap-matching',
    'colmap-mapping',
    'training',
    'normalize',
]

/**
 * Polls /jobs/:id until the reconstruction finishes, showing phase + progress.
 * Calls onDone() when the splat is ready, onCancel() to go back. Cancel first
 * asks the server to kill the job's tool process so training doesn't keep
 * hogging the GPU for a job nobody is watching.
 */
export default function Processing({ jobId, onDone, onCancel }) {
    const [job, setJob] = useState(null)
    const [failed, setFailed] = useState(null)
    const doneRef = useRef(false)

    useEffect(() => {
        let stopped = false
        let timer

        async function poll() {
            try {
                const res = await fetch(`/jobs/${jobId}`)
                if (!res.ok) throw new Error('Job not found (did the server restart?)')
                const data = await res.json()
                if (stopped) return
                setJob(data)
                if (data.status === 'done' && !doneRef.current) {
                    doneRef.current = true
                    onDone()
                    return
                }
                if (data.status === 'error') {
                    setFailed(data.error || 'Reconstruction failed')
                    return
                }
                if (data.status === 'cancelled') return // cancel() already navigated away
            } catch (err) {
                if (!stopped) setFailed(err.message)
                return
            }
            timer = setTimeout(poll, 1500)
        }
        poll()

        return () => {
            stopped = true
            clearTimeout(timer)
        }
    }, [jobId, onDone])

    // Free the server-side job if the user leaves without pressing Cancel:
    // closing the tab, refreshing, or the browser Back button all tear down
    // this screen while COLMAP/Brush keeps running and hogging the GPU. pagehide
    // covers tab close / navigation; the effect cleanup covers in-app unmount.
    // A finished job is left alone so its result stays downloadable, and the
    // DELETE is idempotent, so a redundant call after Cancel is harmless.
    useEffect(() => {
        function killJob() {
            if (doneRef.current) return
            fetch(`/jobs/${jobId}`, { method: 'DELETE', keepalive: true }).catch(() => { })
        }
        window.addEventListener('pagehide', killJob)
        return () => {
            window.removeEventListener('pagehide', killJob)
            killJob()
        }
    }, [jobId])

    // Kill the server-side job, then leave. keepalive lets the request finish
    // even if the page unloads; failures are ignored since we're leaving anyway.
    function cancel() {
        fetch(`/jobs/${jobId}`, { method: 'DELETE', keepalive: true }).catch(() => { })
        onCancel()
    }

    const pct = Math.round((job?.progress ?? 0) * 100)
    const label = PHASE_LABELS[job?.phase] ?? 'Working'
    const phaseIndex = PHASE_ORDER.indexOf(job?.phase)

    // Which state a step in the tracker is in (display only, does not affect the job).
    function stepState(index) {
        if (index < phaseIndex) return 'done'
        if (index === phaseIndex) return 'active'
        return 'pending'
    }

    return (
        <div className="processing-page">
            <div className="forma-card processing-card">
                {failed ? (
                    <>
                        <div className="eyebrow processing-eyebrow-error">Reconstruction failed</div>
                        <h1 className="processing-title">Something went wrong</h1>
                        <p className="processing-error">{failed}</p>
                        <p className="processing-hint">
                            Common causes: too few photos, not enough overlap, or blurry/reflective
                            surfaces. Try again with more, sharper, overlapping photos.
                        </p>
                        <button className="forma-btn forma-btn-primary processing-action" onClick={onCancel}>
                            Start over
                        </button>
                    </>
                ) : (
                    <>
                        <div className="eyebrow eyebrow-accent">Reconstruction</div>
                        <h1 className="processing-title">Building your 3D model</h1>
                        <p className="processing-hint">
                            Running COLMAP and Brush on the server. This takes a few minutes
                            depending on photo count and quality.
                        </p>

                        <div className="processing-phase">
                            {label}...
                            {job?.detail && <span className="processing-detail">{job.detail}</span>}
                        </div>

                        <div className="processing-progress">
                            <div className="processing-bar" aria-hidden="true">
                                <div className="processing-bar-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="processing-pct">{pct}%</div>
                        </div>

                        <ol className="processing-steps">
                            {PHASE_ORDER.map((phaseKey, index) => (
                                <li key={phaseKey} className={`processing-step processing-step-${stepState(index)}`}>
                                    <span className="processing-step-dot"></span>
                                    {PHASE_LABELS[phaseKey]}
                                </li>
                            ))}
                        </ol>

                        <button className="forma-btn processing-action" onClick={cancel}>
                            Cancel
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}
