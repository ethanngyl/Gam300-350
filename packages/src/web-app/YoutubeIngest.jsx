/*!************************************************************************
\file YoutubeIngest.jsx
\author1 Ethan Ng Yong Le
\author2 Bryan Lim Jun Jie
\par DP email1: n.ethanyongle@digipen.edu
\par DP email2: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Lets the user submit a YouTube video link, frame-extraction rate and
model detail (training iteration cap, via TrainingQualitySlider) to the
backend, then polls job status until reconstruction
finishes. The link, fps and "Process video" share one box; under it, a
dashed preview box shows the video's thumbnail once the link is valid
(before that, how to start), with a note on how frames are picked. While a
job runs, the dashed box is replaced by a progress card with the same
design as the photo upload's processing screen (it reuses Processing.css):
current step, iteration counter, progress bar, elapsed time, the video's
thumbnail with a scanning line, the step tracker, and a Cancel button that
stops the job on the server (DELETE /jobs/:id) and frees the GPU. When it
ends, a result card shows the extracted frames and a download link for
the .ply (or why it failed / that it was cancelled). Sounds: a tick each
time a step finishes, success when the model is ready, error if it fails
(none on cancel, since Cancel already plays Back). Also frees an in-progress
server-side job if the user navigates away or closes the tab before it
completes. There is no Back button; the sidebar handles navigation.
**************************************************************************/

import { useCallback, useEffect, useRef, useState } from 'react';
import { playSound } from '../audio/Audio.js';
import Icon from './Icons.jsx';
import NameModelPrompt from './NameModelPrompt.jsx';
import TrainingQualitySlider from './TrainingQualitySlider.jsx';
import { DEFAULT_TRAINING_ITERATIONS } from './TrainingPresets.js';
import './Processing.css';
import './YoutubeIngest.css';

const YT_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);

function withHttpsScheme(input) {
    return /^https?:\/\//i.test(input) ? input : `https://${input}`;
}

// The 11-character video id from a single-video link, or null.
function youtubeVideoId(input) {
    let u;
    try {
        u = new URL(withHttpsScheme(input));
    } catch {
        return null;
    }
    const host = u.hostname.toLowerCase();
    let id = null;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    else if (YT_HOSTS.has(host)) {
        id = u.pathname === '/watch'
            ? u.searchParams.get('v')
            : u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/)?.[1];
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

function normalizeYoutubeUrl(input) {
    return youtubeVideoId(input) ? withHttpsScheme(input) : null;
}

function youtubeThumbnailUrl(videoId) {
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

const FINISHED = ['done', 'error', 'cancelled'];

// How many extracted frames to show once the job is done.
const FRAME_PREVIEW_COUNT = 24;

async function parseJson(res) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            "Couldn't reach the reconstruction server. Make sure it's running " +
            '(cd packages/src/backend && node server.js) on port 5005.',
        );
    }
}

// Same wording as the processing screen (Processing.jsx).
const PHASE_LABELS = {
    extract: 'Extracting frames',
    'colmap-features': 'Analyzing frames',
    'colmap-matching': 'Matching frames',
    'colmap-mapping': 'Recovering camera positions',
    training: 'Training 3D model',
    normalize: 'Finalizing model',
    done: 'Done',
    upload: 'Preparing',
};

// Order the job moves through, for the step tracker (display only).
const PHASE_ORDER = [
    'extract',
    'colmap-features',
    'colmap-matching',
    'colmap-mapping',
    'training',
    'normalize',
];

const STEP_STATE_LABELS = { done: 'Done', active: 'In progress', pending: 'Waiting' };

// "0:42" or "12:05" -- time since Process video was pressed.
function formatElapsed(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function YoutubeIngest() {
    const [url, setUrl] = useState('');
    const [fps, setFps] = useState(2);
    // Training iteration cap from the "Model detail" slider.
    const [trainIters, setTrainIters] = useState(DEFAULT_TRAINING_ITERATIONS);
    const [submitting, setSubmitting] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [error, setError] = useState(null);
    const [job, setJob] = useState(null);
    const [extractedFrames, setExtractedFrames] = useState([]);
    const [hasThumbnailFailed, setHasThumbnailFailed] = useState(false);
    // The video being processed (for the progress card's thumbnail) and when
    // it started, for the elapsed-time counter.
    const [processingVideoId, setProcessingVideoId] = useState(null);
    const [startedAt, setStartedAt] = useState(null);
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    // Set when training finishes, to ask for the model's name.
    const [namePromptJobId, setNamePromptJobId] = useState(null);
    const jobRef = useRef(null);
    const pollRef = useRef(null);
    // Last phase seen, so the tick sound plays once per finished step.
    const lastPhaseRef = useRef(null);

    useEffect(() => {
        jobRef.current = job;
    }, [job]);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    useEffect(() => stopPolling, [stopPolling]);

    useEffect(() => {
        function killJob() {
            const j = jobRef.current;
            if (!j || !j.id || FINISHED.includes(j.status)) return;
            fetch(`/jobs/${j.id}`, { method: 'DELETE', keepalive: true }).catch(() => { });
        }
        window.addEventListener('pagehide', killJob);
        return () => {
            window.removeEventListener('pagehide', killJob);
            killJob();
        };
    }, []);

    // /jobs/:id has no image list, so read this job's frames from /jobs.
    const loadExtractedFrames = useCallback(async (id) => {
        try {
            const res = await fetch('/jobs');
            if (!res.ok) return;
            const allJobs = await parseJson(res);
            const finishedJob = Array.isArray(allJobs) ? allJobs.find((listedJob) => listedJob.id === id) : null;
            setExtractedFrames(finishedJob?.images ?? []);
        } catch {
            // The frames are only a preview; the download still works without them.
        }
    }, []);

    const pollJob = useCallback(
        (id) => {
            stopPolling();
            lastPhaseRef.current = null;
            pollRef.current = setInterval(async () => {
                try {
                    const res = await fetch(`/jobs/${id}`);
                    if (!res.ok) throw new Error(`Status ${res.status}`);
                    const data = await parseJson(res);
                    setJob(data);
                    // A new phase means the previous step finished (not on the first poll).
                    if (data.status === 'running' && lastPhaseRef.current && data.phase !== lastPhaseRef.current) {
                        playSound('tick');
                    }
                    lastPhaseRef.current = data.phase;
                    if (FINISHED.includes(data.status)) {
                        stopPolling();
                        if (data.status === 'done') {
                            playSound('success');
                            setNamePromptJobId(id);
                            loadExtractedFrames(id);
                        }
                        if (data.status === 'error') playSound('error');
                    }
                } catch (err) {
                    playSound('error');
                    setError(`Lost contact with the server: ${err.message}`);
                    stopPolling();
                }
            }, 1500);
        },
        [stopPolling, loadExtractedFrames],
    );

    // Stops the running job on the server (kills its tool so the GPU is freed).
    async function handleCancel() {
        const runningJob = jobRef.current;
        if (!runningJob?.id || FINISHED.includes(runningJob.status)) return;
        playSound('back');
        setIsCancelling(true);
        try {
            const res = await fetch(`/jobs/${runningJob.id}`, { method: 'DELETE' });
            // 409: it finished just before the cancel arrived; polling shows the result.
            if (res.status === 409) return;
            const data = await parseJson(res);
            if (!res.ok) throw new Error(data.error || `Couldn't cancel (${res.status})`);
            stopPolling();
            setJob((previousJob) => ({ ...previousJob, status: 'cancelled', detail: null, error: null }));
        } catch (err) {
            setError(err.message);
        } finally {
            setIsCancelling(false);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        playSound('confirm');
        setError(null);

        const trimmed = normalizeYoutubeUrl(url.trim());
        if (!trimmed) {
            setError('Please enter a link to a single YouTube video (not a playlist or channel).');
            return;
        }

        setSubmitting(true);
        setJob(null);
        setExtractedFrames([]);
        try {
            const res = await fetch('/jobs/from-youtube', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: trimmed, fps: Number(fps) || undefined, trainIters }),
            });
            const data = await parseJson(res);
            if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
            setJob({ id: data.id, status: 'running', phase: 'extract', progress: 0 });
            setProcessingVideoId(youtubeVideoId(trimmed));
            setStartedAt(Date.now());
            setCurrentTime(Date.now());
            pollJob(data.id);
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    const busy = submitting || (job && !FINISHED.includes(job.status));
    const pct = job ? Math.round((job.progress || 0) * 100) : 0;
    const phaseLabel = job ? PHASE_LABELS[job.phase] || job.phase : '';
    const videoId = youtubeVideoId(url.trim());
    const isJobDone = job?.status === 'done';
    const isJobCancelled = job?.status === 'cancelled';
    // A job exists on the server and hasn't finished, so it can be cancelled.
    const isJobRunning = Boolean(job?.id) && !FINISHED.includes(job.status);
    const elapsedSeconds = startedAt ? Math.max(0, Math.floor((currentTime - startedAt) / 1000)) : 0;
    const phaseIndex = job ? PHASE_ORDER.indexOf(job.phase) : -1;

    // Ticks the elapsed-time counter once a second while a job runs.
    useEffect(() => {
        if (!isJobRunning) return;
        const timerId = setInterval(() => setCurrentTime(Date.now()), 1000);
        return () => clearInterval(timerId);
    }, [isJobRunning]);

    // Which state a step in the tracker is in (display only).
    function stepState(index) {
        if (index < phaseIndex) return 'done';
        if (index === phaseIndex) return 'active';
        return 'pending';
    }

    return (
        <div className="yt">
            <div className="yt-heading">
                <div>
                    <div className="eyebrow eyebrow-accent">Frame capture</div>
                    <h1 className="yt-title">YouTube Extractor</h1>
                    <p className="yt-subtitle">
                        Paste a link to a video that orbits an object. We extract evenly spaced
                        frames and run them through the same reconstruction pipeline, so no
                        phone capture is needed.
                    </p>
                </div>
            </div>

            <div className="yt-layout">
                <form className="forma-card yt-card yt-source" onSubmit={handleSubmit}>
                    <label className="eyebrow yt-source-label" htmlFor="yt-url">Video URL</label>
                    <div className="yt-row">
                        <div className="yt-input-wrap">
                            <Icon name="link" size={16} />
                            <input
                                id="yt-url"
                                type="url"
                                className="yt-input"
                                placeholder="https://youtube.com/watch?v=..."
                                value={url}
                                onChange={(e) => {
                                    setUrl(e.target.value);
                                    setHasThumbnailFailed(false);
                                }}
                                disabled={busy}
                            />
                        </div>
                        <label className="yt-fps">
                            <input
                                type="number"
                                min="0.1"
                                max="30"
                                step="0.1"
                                value={fps}
                                onChange={(e) => setFps(e.target.value)}
                                disabled={busy}
                                aria-label="Frames per second to extract"
                            />
                            <span>fps</span>
                        </label>
                        <button type="submit" className="forma-btn forma-btn-primary yt-submit" disabled={busy || !url.trim()}>
                            <Icon name="playSolid" size={14} /> {busy ? 'Processing...' : 'Process video'}
                        </button>
                    </div>

                    <TrainingQualitySlider iterations={trainIters} onChange={setTrainIters} disabled={busy} />

                    {error && <p className="yt-error">{error}</p>}
                </form>

                {/* Shows the video's thumbnail once the link is valid, else how to start.
                    Hidden while a job runs: the progress card shows the thumbnail then. */}
                {!isJobRunning && <div className="yt-preview-box">
                    {videoId && !hasThumbnailFailed ? (
                        <div className="yt-preview">
                            <img
                                src={youtubeThumbnailUrl(videoId)}
                                alt="Thumbnail of the linked video"
                                onError={() => setHasThumbnailFailed(true)}
                            />
                        </div>
                    ) : (
                        <>
                            <span className="yt-preview-icon"><Icon name="video" size={34} /></span>
                            <p className="yt-preview-title">Enter a YouTube URL above and click Process video</p>
                            <p className="yt-preview-formats">Supports youtube.com/watch and youtu.be short links</p>
                        </>
                    )}
                    <p className="yt-hint">
                        We pull evenly spaced frames from across the whole video (up to 20 minutes),
                        skip blurry and duplicate ones, and feed them straight into the reconstruction
                        pipeline. Higher fps = more frames = slower, more detailed scans.
                    </p>
                </div>}

                {isJobRunning && (
                    <div className="forma-card yt-card processing-embedded">
                        <div className="processing-card">
                            <div className="processing-main">
                                <div className="eyebrow eyebrow-accent">Reconstruction</div>
                                <h2 className="processing-title">Building your 3D model</h2>
                                <p className="processing-hint">
                                    Downloading the video and extracting frames, then running COLMAP and
                                    Brush on the server. This takes a few minutes depending on the video.
                                </p>

                                <div className="processing-status" aria-live="polite">
                                    <div className="processing-status-head">
                                        <span className="processing-phase">{phaseLabel || 'Starting'}</span>
                                        <span className="processing-pct">{pct}%</span>
                                    </div>
                                    {job.detail && <span className="processing-detail">{job.detail}</span>}
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
                                        {phaseIndex >= 0 && <span>Step {phaseIndex + 1} of {PHASE_ORDER.length}</span>}
                                    </div>
                                </div>

                                <p className="processing-note">
                                    <Icon name="eye" size={14} />
                                    Keep this page open. Leaving or closing it cancels the build.
                                </p>

                                <button
                                    type="button"
                                    className="forma-btn processing-action processing-cancel"
                                    onClick={handleCancel}
                                    disabled={isCancelling}
                                >
                                    {isCancelling ? 'Cancelling...' : 'Cancel'}
                                </button>
                            </div>

                            <div className="processing-side">
                                <div className="processing-preview">
                                    {processingVideoId
                                        ? <img src={youtubeThumbnailUrl(processingVideoId)} alt="" />
                                        : <span className="processing-preview-icon"><Icon name="video" size={34} /></span>}
                                    <span className="processing-scan" aria-hidden="true"></span>
                                    <span className="processing-corner processing-corner-tl"></span>
                                    <span className="processing-corner processing-corner-tr"></span>
                                    <span className="processing-corner processing-corner-bl"></span>
                                    <span className="processing-corner processing-corner-br"></span>
                                    <span className="processing-chip">
                                        <Icon name={job.imageCount != null ? 'image' : 'play'} size={12} />
                                        {job.imageCount != null ? ` ${job.imageCount} frames` : ' YouTube video'}
                                    </span>
                                </div>

                                <ol className="processing-steps">
                                    {PHASE_ORDER.map((phaseKey, index) => {
                                        const state = stepState(index);
                                        return (
                                            <li key={phaseKey} className={`processing-step processing-step-${state}`}>
                                                <span className="processing-step-dot">
                                                    {state === 'done' && <Icon name="check" size={11} />}
                                                </span>
                                                <span className="processing-step-label">{PHASE_LABELS[phaseKey]}</span>
                                                <span className="processing-step-state">{STEP_STATE_LABELS[state]}</span>
                                            </li>
                                        );
                                    })}
                                </ol>
                            </div>
                        </div>
                    </div>
                )}

                {job && !isJobRunning && (
                    <div className="forma-card yt-card">
                        <div>
                            <div className="eyebrow">Progress</div>
                            <h2 className="yt-card-title">{isJobDone ? 'Extracted frames' : isJobCancelled ? 'Cancelled' : 'Something went wrong'}</h2>
                        </div>

                        <div className="yt-status">
                            <div className="yt-status-head">
                                <span className={`yt-badge yt-badge-${job.status}`}>{job.status}</span>
                                <span className="yt-phase">
                                    {isJobDone ? 'Done' : isJobCancelled ? 'Cancelled. Press Process video to start again.' : job.detail || phaseLabel}
                                </span>
                                {job.imageCount != null && (
                                    <span className="yt-frames">{job.imageCount} frames</span>
                                )}
                            </div>

                            {job.error && <p className="yt-error">{job.error}</p>}

                            {isJobDone && extractedFrames.length > 0 && (
                                <div className="yt-frame-grid">
                                    {extractedFrames.slice(0, FRAME_PREVIEW_COUNT).map((frame) => (
                                        <img key={frame.name} src={frame.url} alt={frame.name} loading="lazy" />
                                    ))}
                                </div>
                            )}
                            {isJobDone && extractedFrames.length > FRAME_PREVIEW_COUNT && (
                                <p className="yt-hint">
                                    Showing {FRAME_PREVIEW_COUNT} of {extractedFrames.length} frames. The rest are in the Media Library.
                                </p>
                            )}

                            {isJobDone && (
                                <a className="forma-btn forma-btn-primary yt-download" href={`/jobs/${job.id}/result.ply`}>
                                    Download result (.ply)
                                </a>
                            )}
                        </div>
                    </div>
                )}
            </div>
            {namePromptJobId && (
                <NameModelPrompt jobId={namePromptJobId} onClose={() => setNamePromptJobId(null)} />
            )}
        </div>
    );
}

export default YoutubeIngest;