/*!************************************************************************
\file Processing.jsx
\author Xiong Yang
\par DP email1: xiong.yang@digipen.edu
\par DP email2: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 09-10-2026
\brief
The screen shown while the backend reconstructs a job (builds the .ply).
It polls the server for the job's phase and progress and hands off to the
viewer once the splat is ready. Leaving the screen in any way (Cancel,
closing the tab, refreshing, Back) tells the server to kill the job so
COLMAP/Brush don't keep running on the GPU for nobody.
Layout (GENESIS theme): on wider screens, the live status (current step,
iteration counter, progress bar, elapsed time, Cancel) sits beside a
preview of the job's first photo with a scanning effect and the step
tracker. On phones everything stacks in one column, with the preview as
a short banner on top and a full-width Cancel button at the bottom.
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
import Icon from './Icons.jsx'
import { playSound } from '../audio/Audio.js'

// Friendly labels for the backend's phase names.
const PHASE_LABELS = {
    upload: 'Uploading photos',
    masking: 'Removing backgrounds',
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
    'masking',
    'colmap-features',
    'colmap-matching',
    'colmap-mapping',
    'training',
    'normalize',
]

const STEP_STATE_LABELS = { done: 'Done', active: 'In progress', pending: 'Waiting' }

// "0:42" or "12:05" -- time since this screen opened.
function formatElapsed(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Polls /jobs/:id until the reconstruction finishes, showing phase + progress.
 * Calls onDone() when the splat is ready, onCancel() to go back. Cancel first
 * asks the server to kill the job's tool process so training doesn't keep
 * hogging the GPU for a job nobody is watching.
 */
export default function Processing({ jobId, onDone, onCancel }) {
    const [job, setJob] = useState(null)
    const [failed, setFailed] = useState(null)
    // The job's first photo and photo count, for the preview (from GET /jobs,
    // since /jobs/:id has no image list). Only for show; may stay empty.
    const [previewPhoto, setPreviewPhoto] = useState(null)
    const [photoCount, setPhotoCount] = useState(null)
    const [elapsedSeconds, setElapsedSeconds] = useState(0)
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

    // Load the preview photo once. Failing is fine: the preview shows an icon.
    useEffect(() => {
        let stopped = false
        async function loadPreview() {
            try {
                const res = await fetch('/jobs')
                if (!res.ok) return
                const allJobs = await res.json()
                const thisJob = Array.isArray(allJobs) ? allJobs.find((listedJob) => listedJob.id === jobId) : null
                if (stopped || !thisJob) return
                setPreviewPhoto(thisJob.images?.[0]?.url ?? null)
                setPhotoCount(thisJob.images?.length ?? thisJob.imageCount ?? null)
            } catch {
                // Preview only; nothing to show.
            }
        }
        loadPreview()
        return () => { stopped = true }
    }, [jobId])

    // Elapsed-time counter, stopped once the job fails.
    useEffect(() => {
        if (failed) return
        const timerId = setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000)
        return () => clearInterval(timerId)
    }, [failed])

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
    const label = PHASE_LABELS[job?.phase] ?? 'Starting'
    // The masking step only runs for jobs sent with "Remove background" on.
    const phases = PHASE_ORDER.filter((p) => p !== 'masking' || job?.removeBackground)
    const phaseIndex = phases.indexOf(job?.phase)

    // Which state a step in the tracker is in (display only, does not affect the job).
    function stepState(index) {
        if (index < phaseIndex) return 'done'
        if (index === phaseIndex) return 'active'
        return 'pending'
    }

    if (failed) {
        return (
            <div className="processing-page">
                <div className="forma-card processing-card processing-card-failed">
                    <span className="processing-failed-icon"><Icon name="triangle" size={22} /></span>
                    <div className="eyebrow processing-eyebrow-error">Reconstruction failed</div>
                    <h1 className="processing-title">Something went wrong</h1>
                    <p className="processing-error">{failed}</p>
                    <p className="processing-hint">
                        Common causes: too few photos, not enough overlap, or blurry/reflective
                        surfaces. Try again with more, sharper, overlapping photos.
                    </p>
                    <button
                        className="forma-btn forma-btn-primary processing-action"
                        onClick={() => {
                            playSound('back')
                            onCancel()
                        }}
                    >
                        Start over
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="processing-page">
            <div className="forma-card processing-card">
                <div className="processing-main">
                    <div className="eyebrow eyebrow-accent">Reconstruction</div>
                    <h1 className="processing-title">Building your 3D model</h1>
                    <p className="processing-hint">
                        Running COLMAP and Brush on the server. This takes a few minutes
                        depending on photo count and quality.
                    </p>

                    <div className="processing-status" aria-live="polite">
                        <div className="processing-status-head">
                            <span className="processing-phase">{label}</span>
                            <span className="processing-pct">{pct}%</span>
                        </div>
                        {job?.detail && <span className="processing-detail">{job.detail}</span>}
                        <div
                            className="processing-bar"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={pct}
                            aria-label="Reconstruction progress"
                        >
                            <div className="processing-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="processing-meta">
                            <span>Elapsed {formatElapsed(elapsedSeconds)}</span>
                            {phaseIndex >= 0 && <span>Step {phaseIndex + 1} of {phases.length}</span>}
                        </div>
                    </div>

                    <p className="processing-note">
                        <Icon name="eye" size={14} />
                        Keep this page open. Leaving or closing it cancels the build.
                    </p>

                    <button
                        className="forma-btn processing-action processing-cancel"
                        onClick={() => {
                            playSound('back')
                            cancel()
                        }}
                    >
                        Cancel
                    </button>
                </div>

                <div className="processing-side">
                    <div className="processing-preview">
                        {previewPhoto
                            ? <img src={previewPhoto} alt="" />
                            : <span className="processing-preview-icon"><Icon name="cube" size={34} /></span>}
                        <span className="processing-scan" aria-hidden="true"></span>
                        <span className="processing-corner processing-corner-tl"></span>
                        <span className="processing-corner processing-corner-tr"></span>
                        <span className="processing-corner processing-corner-bl"></span>
                        <span className="processing-corner processing-corner-br"></span>
                        {photoCount != null && (
                            <span className="processing-chip">
                                <Icon name="image" size={12} /> {photoCount} photos
                            </span>
                        )}
                    </div>

                    <ol className="processing-steps">
                        {phases.map((phaseKey, index) => {
                            const state = stepState(index)
                            return (
                                <li key={phaseKey} className={`processing-step processing-step-${state}`}>
                                    <span className="processing-step-dot">
                                        {state === 'done' && <Icon name="check" size={11} />}
                                    </span>
                                    <span className="processing-step-label">{PHASE_LABELS[phaseKey]}</span>
                                    <span className="processing-step-state">{STEP_STATE_LABELS[state]}</span>
                                </li>
                            )
                        })}
                    </ol>
                </div>
            </div>
        </div>
    )
}