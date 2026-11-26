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
viewer once the splat is ready. It is now the "Details" view of a build
running in the background (BuildPanel.jsx): leaving it doesn't stop the
build, which keeps going and stays in the build panel; only Cancel stops
it. The build panel's tracker (useBackgroundBuilds.js) plays the tick,
success and error sounds, so this screen doesn't play them twice.
Layout (GENESIS theme): on wider screens, the live status (current step,
iteration counter, progress bar, elapsed time, Cancel) sits beside a
preview of the job's first photo with a scanning effect and the step
tracker. On phones everything stacks in one column, with the preview as
a short banner on top and a full-width Cancel button at the bottom.
Video Extractor builds (videos / GIFs) use this screen too, with source
'media': their steps start with "Uploading media" and "Extracting frames",
the preview shows the first extracted frame once there is one, and a
failure gives tips for videos.
- PHASE_LABELS / MEDIA_PHASE_LABELS
Map the backend's phase names to the labels shown to the user.
- Processing({ jobId, source, onDone, onCancel, onLeave })
React component. Polls /jobs/:id every 1.5s until the job is done, failed or
cancelled. Calls onDone() when the splat is ready, onCancel() after Cancel
(or on finding the build already cancelled) and onLeave() for "Back to
dashboard", which leaves the build running. Shows an error message with
tips if the reconstruction fails.
source: 'photos' or 'media' (a Video Extractor build), from the build
panel; the server's GET /jobs/:id doesn't say which.
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
    crop: 'Keeping the main object',
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
    'crop',
    'normalize',
]

// Frame Extractor builds: frames instead of photos, and the media upload first.
const MEDIA_PHASE_LABELS = {
    ...PHASE_LABELS,
    upload: 'Uploading media',
    extract: 'Extracting frames',
    'colmap-features': 'Analyzing frames',
    'colmap-matching': 'Matching frames',
}

const MEDIA_PHASE_ORDER = [
    'upload',
    'extract',
    'masking',
    'colmap-features',
    'colmap-matching',
    'colmap-mapping',
    'training',
    'crop',
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
export default function Processing({ jobId, source = 'photos', onDone, onCancel, onLeave = null }) {
    const [job, setJob] = useState(null)
    const [failed, setFailed] = useState(null)
    // The job's first photo and photo count, for the preview (from GET /jobs,
    // since /jobs/:id has no image list). Only for show; may stay empty.
    const [previewPhoto, setPreviewPhoto] = useState(null)
    const [photoCount, setPhotoCount] = useState(null)
    const [elapsedSeconds, setElapsedSeconds] = useState(0)
    const doneRef = useRef(false)
    const isMediaBuild = source === 'media'
    const hasFailed = Boolean(failed)

    useEffect(() => {
        let stopped = false
        let timer

        async function poll() {
            try {
                const res = await fetch(`/api/v1/jobs/${jobId}`)
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
                // Pressing Cancel already left this screen. Otherwise the build was
                // cancelled while away (Back, then Forward, or a reload): leave too.
                if (data.status === 'cancelled') {
                    onCancel()
                    return
                }
            } catch (err) {
                if (!stopped) {
                    playSound('error')
                    setFailed(err.message)
                }
                return
            }
            timer = setTimeout(poll, 1500)
        }
        poll()

        return () => {
            stopped = true
            clearTimeout(timer)
        }
    }, [jobId, onDone, onCancel])

    // Phases this build moves through (display only, does not affect the job).
    // The masking step only runs for jobs sent with "Remove background" on,
    // and the crop step for jobs sent with "Keep only the main object" on.
    const isRemovingBackground = job?.removeBackground ?? false
    const isAutoCropping = job?.autoCrop ?? false
    const phaseLabels = isMediaBuild ? MEDIA_PHASE_LABELS : PHASE_LABELS
    const phases = (isMediaBuild ? MEDIA_PHASE_ORDER : PHASE_ORDER)
        .filter((p) => p !== 'masking' || isRemovingBackground)
        .filter((p) => p !== 'crop' || isAutoCropping)
    const currentPhase = job?.phase ?? null
    // The job hasn't started (queued behind another build, or not polled
    // yet). The server still calls this phase 'upload', but the files are
    // already there, so the upload step shows as done.
    const isWaitingToStart = !job || job.status === 'queued'
    const phaseIndex = isWaitingToStart ? phases.indexOf('upload') + 1 : phases.indexOf(currentPhase)
    // A video's frames only exist once extraction has finished.
    const hasPreviewFrames = !isMediaBuild || phaseIndex > phases.indexOf('extract')

    // Load the preview photo (a media build's first frame) once there is one.
    // Failing is fine: the preview shows an icon.
    useEffect(() => {
        if (!hasPreviewFrames) return
        let stopped = false
        async function loadPreview() {
            try {
                const res = await fetch('/api/v1/jobs')
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
    }, [jobId, hasPreviewFrames])

    // Elapsed-time counter, stopped once the build fails.
    useEffect(() => {
        if (hasFailed) return
        const timerId = setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000)
        return () => clearInterval(timerId)
    }, [hasFailed])

    // Kill the server-side job, then leave. keepalive lets the request finish
    // even if the page unloads; failures are ignored since we're leaving anyway.
    function cancel() {
        fetch(`/api/v1/jobs/${jobId}`, { method: 'DELETE', keepalive: true }).catch(() => { })
        onCancel()
    }

    const pct = isWaitingToStart ? 0 : Math.round((job?.progress ?? 0) * 100)
    const label = isWaitingToStart ? 'Waiting to start' : (phaseLabels[currentPhase] ?? 'Starting')
    const failure = failed

    // Which state a step in the tracker is in (display only, does not affect the job).
    function stepState(index) {
        if (index < phaseIndex) return 'done'
        // While waiting to start, the next step hasn't begun yet.
        if (index === phaseIndex && !isWaitingToStart) return 'active'
        return 'pending'
    }

    if (failure) {
        return (
            <div className="processing-page">
                <div className="forma-card processing-card processing-card-failed">
                    <span className="processing-failed-icon"><Icon name="triangle" size={22} /></span>
                    <div className="eyebrow processing-eyebrow-error">Reconstruction failed</div>
                    <h1 className="processing-title">Something went wrong</h1>
                    <p className="processing-error">{failure}</p>
                    <p className="processing-hint">
                        {isMediaBuild
                            ? 'Common causes: the camera does not circle the object, the video is blurry or shaky, or it moves too fast. Try a slower, steadier video, or a higher fps.'
                            : 'Common causes: too few photos, not enough overlap, or blurry/reflective surfaces. Try again with more, sharper, overlapping photos.'}
                    </p>
                    <button
                        className="forma-btn forma-btn-primary processing-action"
                        onClick={() => {
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
                        {isMediaBuild
                            ? 'Extracting frames from your files, then running COLMAP and Brush on the server. This takes a few minutes depending on the media and fps.'
                            : 'Running COLMAP and Brush on the server. This takes a few minutes depending on photo count and quality.'}
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
                        You can leave this page. The build keeps going and shows in the corner.
                    </p>

                    {onLeave && (
                        <button
                            className="forma-btn forma-btn-primary processing-action"
                            onClick={() => {
                                onLeave()
                            }}
                        >
                            Back to dashboard
                        </button>
                    )}
                    <button
                        className="forma-btn processing-action processing-cancel"
                        onClick={() => {
                            cancel()
                        }}
                    >
                        Cancel build
                    </button>
                </div>

                <div className="processing-side">
                    <div className="processing-preview">
                        {previewPhoto
                            ? <img src={previewPhoto} alt="" />
                            : <span className="processing-preview-icon"><Icon name={isMediaBuild ? 'video' : 'cube'} size={34} /></span>}
                        <span className="processing-scan" aria-hidden="true"></span>
                        <span className="processing-corner processing-corner-tl"></span>
                        <span className="processing-corner processing-corner-tr"></span>
                        <span className="processing-corner processing-corner-bl"></span>
                        <span className="processing-corner processing-corner-br"></span>
                        {isMediaBuild ? (
                            <span className="processing-chip">
                                <Icon name="video" size={12} />
                                <span className="processing-chip-text">
                                    Video
                                    {photoCount != null && hasPreviewFrames ? ` \u00B7 ${photoCount} frames` : ''}
                                </span>
                            </span>
                        ) : photoCount != null && (
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
                                    <span className="processing-step-label">{phaseLabels[phaseKey]}</span>
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