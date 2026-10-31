/*!************************************************************************
\file FrameExtractor.jsx
\author1 Ethan Ng Yong Le
\author2 Bryan Lim Jun Jie
\par DP email1: n.ethanyongle@digipen.edu
\par DP email2: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Lets the user upload media files (videos or animated GIFs), and set a
frame-extraction rate, the Remove background option (on by default) and model
detail (training iteration cap, via TrainingQualitySlider). The files go to the backend, which extracts their
frames and reconstructs a model from them, and the page polls job status until
that finishes. The drop zone, chosen files, fps and "Process media" share one
box, with a note under it on how frames are picked. A bar shows the upload
while it runs, and Cancel stops it. While a job runs, the note is replaced by a
progress card with the same design as the photo upload's processing screen (it
reuses Processing.css): current step, iteration counter, progress bar, elapsed
time, a preview of the first file with a scanning line, the step tracker, and a
Cancel button that stops the job on the server (DELETE /jobs/:id) and frees the
GPU. When it ends, a result card shows the extracted frames and a download link
for the .ply (or why it failed / that it was cancelled). Sounds: a tick each
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
import './FrameExtractor.css';

// Same rules as the backend (MEDIA_EXT_RE, maxMediaFiles and maxMediaSizeMB in
// server.js / config.js), checked here so a bad file isn't uploaded for nothing.
const MEDIA_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpe?g|gif)$/i;
const MAX_MEDIA_FILES = 10;
const MAX_MEDIA_SIZE_MB = 2048;
// Browsers don't list every video type under video/*, so name the extras.
const MEDIA_ACCEPT = 'video/*,image/gif,.mkv,.avi';

const FINISHED = ['done', 'error', 'cancelled'];

// How many extracted frames to show once the job is done.
const FRAME_PREVIEW_COUNT = 24;

const SERVER_UNREACHABLE =
    "Couldn't reach the reconstruction server. Make sure it's running " +
    '(cd packages/src/backend && node server.js) on port 5005.';

async function parseJson(res) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(SERVER_UNREACHABLE);
    }
}

// Sends the files with XMLHttpRequest, because fetch can't report upload
// progress and a video can take a while. onStart receives the request, so
// Cancel can abort it. Resolves with the new job's id; rejects with a readable
// error, or with { aborted: true } when it was cancelled.
function uploadMedia(files, { fps, trainIters, removeBackground }, onStart, onProgress) {
    return new Promise((resolve, reject) => {
        const body = new FormData();
        body.append('fps', String(fps));
        body.append('trainIters', String(trainIters));
        body.append('removeBackground', String(removeBackground));
        files.forEach((file) => body.append('media', file, file.name));

        const xhr = new XMLHttpRequest();
        onStart(xhr);
        xhr.open('POST', '/jobs/from-media');
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(e.loaded / e.total);
        };
        xhr.onload = () => {
            let data = null;
            try {
                data = JSON.parse(xhr.responseText);
            } catch {
                // Not from our server, e.g. a tunnel or proxy refusing the upload.
            }
            if (xhr.status === 413 && !data) {
                reject(new Error('This connection refused an upload that large. Try smaller files, or use the app on http://localhost:5005.'));
            } else if (!data) {
                reject(new Error(SERVER_UNREACHABLE));
            } else if (xhr.status < 200 || xhr.status >= 300) {
                reject(new Error(data.error || `Request failed (${xhr.status})`));
            } else {
                resolve(data.id);
            }
        };
        xhr.onerror = () => reject(new Error(SERVER_UNREACHABLE));
        xhr.onabort = () => reject({ aborted: true });
        xhr.send(body);
    });
}

function createMediaItem(file) {
    return {
        id: `${file.name}-${file.lastModified}-${Math.random()}`,
        url: URL.createObjectURL(file),
        file,
        isGif: /\.gif$/i.test(file.name),
    };
}

function formatFileSize(bytes) {
    const megabytes = bytes / (1024 * 1024);
    return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes.toFixed(1)} MB`;
}

// Shows a file's opening frame. Not every format plays in a browser (often
// .mkv or .avi), so this falls back to an icon; the server can still read them.
function MediaPreview({ item }) {
    const [hasFailed, setHasFailed] = useState(false);
    if (hasFailed) return <span className="fx-media-fallback"><Icon name="video" size={18} /></span>;
    if (item.isGif) return <img src={item.url} alt="" onError={() => setHasFailed(true)} />;
    return (
        <video
            // #t skips the first instant, which is often a black frame.
            src={`${item.url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            onError={() => setHasFailed(true)}
        />
    );
}

// Same wording as the processing screen (Processing.jsx).
const PHASE_LABELS = {
    extract: 'Extracting frames',
    masking: 'Removing backgrounds',
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
    'masking',
    'colmap-features',
    'colmap-matching',
    'colmap-mapping',
    'training',
    'normalize',
];

const STEP_STATE_LABELS = { done: 'Done', active: 'In progress', pending: 'Waiting' };

// "0:42" or "12:05" -- time since Process media was pressed.
function formatElapsed(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function FrameExtractor() {
    const [mediaItems, setMediaItems] = useState([]);
    const [isDragging, setIsDragging] = useState(false);
    const [fps, setFps] = useState(2);
    // Mask out the background before reconstruction. On by default here, since
    // a video of a turntable otherwise makes the model come out flat or
    // incoherent, and solving the camera positions takes far longer.
    const [removeBackground, setRemoveBackground] = useState(true);
    // Training iteration cap from the "Model detail" slider.
    const [trainIters, setTrainIters] = useState(DEFAULT_TRAINING_ITERATIONS);
    const [submitting, setSubmitting] = useState(false);
    // How far the upload has got (0-1), while submitting.
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isCancelling, setIsCancelling] = useState(false);
    const [error, setError] = useState(null);
    const [job, setJob] = useState(null);
    const [extractedFrames, setExtractedFrames] = useState([]);
    // When the job started, for the elapsed-time counter.
    const [startedAt, setStartedAt] = useState(null);
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    // Set when training finishes, to ask for the model's name.
    const [namePromptJobId, setNamePromptJobId] = useState(null);
    const fileInputRef = useRef(null);
    const progressCardRef = useRef(null);
    // The upload in progress, so Cancel or leaving the page can abort it.
    const uploadXhrRef = useRef(null);
    // Latest file list, read when the page closes to release preview URLs.
    const mediaItemsRef = useRef([]);
    const jobRef = useRef(null);
    const pollRef = useRef(null);
    // Last phase seen, so the tick sound plays once per finished step.
    const lastPhaseRef = useRef(null);

    useEffect(() => {
        jobRef.current = job;
    }, [job]);

    useEffect(() => {
        mediaItemsRef.current = mediaItems;
    }, [mediaItems]);

    // Release the preview URLs and stop any upload when the page closes.
    useEffect(() => {
        return () => {
            uploadXhrRef.current?.abort();
            mediaItemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
        };
    }, []);

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

    function addFiles(fileList) {
        const chosenFiles = Array.from(fileList);
        const usableFiles = chosenFiles.filter((file) => MEDIA_EXT_RE.test(file.name));
        const smallEnoughFiles = usableFiles.filter((file) => file.size <= MAX_MEDIA_SIZE_MB * 1024 * 1024);
        const newFiles = smallEnoughFiles.slice(0, MAX_MEDIA_FILES - mediaItems.length);

        if (usableFiles.length < chosenFiles.length) {
            setError('Only videos and animated GIFs can be used here. For photos, use New model.');
        } else if (smallEnoughFiles.length < usableFiles.length) {
            setError(`Each file must be under ${formatFileSize(MAX_MEDIA_SIZE_MB * 1024 * 1024)}.`);
        } else if (newFiles.length < smallEnoughFiles.length) {
            setError(`You can add up to ${MAX_MEDIA_FILES} files at a time.`);
        } else {
            setError(null);
        }
        setMediaItems((prev) => [...prev, ...newFiles.map(createMediaItem)]);
    }

    function removeMediaItem(id) {
        const removedItem = mediaItems.find((item) => item.id === id);
        if (removedItem) URL.revokeObjectURL(removedItem.url);
        setMediaItems((prev) => prev.filter((item) => item.id !== id));
    }

    function handleFileInputChange(e) {
        if (e.target.files) addFiles(e.target.files);
        e.target.value = '';
    }

    function handleDragOver(e) {
        e.preventDefault();
        if (!busy) setIsDragging(true);
    }

    function handleDrop(e) {
        e.preventDefault();
        setIsDragging(false);
        if (!busy && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    }

    function handleBrowseClick() {
        if (busy) return;
        playSound('tap');
        fileInputRef.current?.click();
    }

    function handleCancelUpload() {
        playSound('back');
        uploadXhrRef.current?.abort();
    }

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
        if (mediaItems.length === 0) return;
        playSound('confirm');
        setError(null);
        setSubmitting(true);
        setUploadProgress(0);
        setJob(null);
        setExtractedFrames([]);
        try {
            const id = await uploadMedia(
                mediaItems.map((item) => item.file),
                { fps: Number(fps) || 2, trainIters, removeBackground },
                (xhr) => {
                    uploadXhrRef.current = xhr;
                },
                setUploadProgress,
            );
            setJob({ id, status: 'running', phase: 'extract', progress: 0, removeBackground });
            setStartedAt(Date.now());
            setCurrentTime(Date.now());
            pollJob(id);
        } catch (err) {
            if (!err.aborted) setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    const busy = submitting || (job && !FINISHED.includes(job.status));
    const pct = job ? Math.round((job.progress || 0) * 100) : 0;
    const uploadPct = Math.round(uploadProgress * 100);
    const phaseLabel = job ? PHASE_LABELS[job.phase] || job.phase : '';
    const isJobDone = job?.status === 'done';
    const isJobCancelled = job?.status === 'cancelled';
    // A job exists on the server and hasn't finished, so it can be cancelled.
    const isJobRunning = Boolean(job?.id) && !FINISHED.includes(job.status);
    const elapsedSeconds = startedAt ? Math.max(0, Math.floor((currentTime - startedAt) / 1000)) : 0;
    // The masking step only runs for jobs sent with "Remove background" on.
    const phases = PHASE_ORDER.filter((phase) => phase !== 'masking' || job?.removeBackground);
    const phaseIndex = job ? phases.indexOf(job.phase) : -1;

    // Ticks the elapsed-time counter once a second while a job runs.
    useEffect(() => {
        if (!isJobRunning) return;
        const timerId = setInterval(() => setCurrentTime(Date.now()), 1000);
        return () => clearInterval(timerId);
    }, [isJobRunning]);

    // The upload box is tall, so bring the progress card into view when it appears.
    useEffect(() => {
        if (isJobRunning) progressCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [isJobRunning]);

    // Which state a step in the tracker is in (display only).
    function stepState(index) {
        if (index < phaseIndex) return 'done';
        if (index === phaseIndex) return 'active';
        return 'pending';
    }

    return (
        <div className="fx">
            <div className="fx-heading">
                <div>
                    <div className="eyebrow eyebrow-accent">Frame capture</div>
                    <h1 className="fx-title">Frame Extractor</h1>
                    <p className="fx-subtitle">
                        Upload videos that orbit an object. We extract evenly spaced frames and
                        run them through the same reconstruction pipeline, so no live camera
                        capture is needed.
                    </p>
                </div>
            </div>

            <div className="fx-layout">
                <form className="forma-card fx-card fx-source" onSubmit={handleSubmit}>
                    <div
                        className={`fx-dropzone${isDragging ? ' is-dragging' : ''}${busy ? ' is-disabled' : ''}`}
                        onDragOver={handleDragOver}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={handleBrowseClick}
                    >
                        <span className="fx-dropzone-icon"><Icon name="video" size={30} /></span>
                        <p className="fx-dropzone-title">Drop media files here</p>
                        <p className="fx-dropzone-or">or</p>
                        <button
                            type="button"
                            className="forma-btn"
                            disabled={busy}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleBrowseClick();
                            }}
                        >
                            Browse files
                        </button>
                        <span className="fx-dropzone-types">MP4 - MOV - WEBM - MKV - AVI - MPEG - GIF</span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={MEDIA_ACCEPT}
                            multiple
                            onChange={handleFileInputChange}
                            style={{ display: 'none' }}
                            aria-label="Choose media files"
                        />
                    </div>

                    {mediaItems.length > 0 && (
                        <ul className="fx-media-list">
                            {mediaItems.map((item) => (
                                <li key={item.id} className="fx-media-item">
                                    <span className="fx-media-thumb"><MediaPreview item={item} /></span>
                                    <span className="fx-media-name" title={item.file.name}>{item.file.name}</span>
                                    <span className="fx-media-size">{formatFileSize(item.file.size)}</span>
                                    <button
                                        type="button"
                                        className="fx-media-remove"
                                        aria-label={`Remove ${item.file.name}`}
                                        disabled={busy}
                                        onClick={() => {
                                            playSound('tap');
                                            removeMediaItem(item.id);
                                        }}
                                    >
                                        <Icon name="plus" size={14} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    <div className="fx-row">
                        <label className="fx-fps">
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
                        <button type="submit" className="forma-btn forma-btn-primary fx-submit" disabled={busy || mediaItems.length === 0}>
                            <Icon name="playSolid" size={14} /> {busy ? 'Processing...' : 'Process media'}
                        </button>
                    </div>

                    <label className="fx-option">
                        <input
                            type="checkbox"
                            checked={removeBackground}
                            disabled={busy}
                            onChange={(e) => {
                                playSound('tap');
                                setRemoveBackground(e.target.checked);
                            }}
                        />
                        <span>
                            Remove background
                            <small>Keeps just the object. Turn off to keep the surroundings in the model.</small>
                        </span>
                    </label>

                    <TrainingQualitySlider iterations={trainIters} onChange={setTrainIters} disabled={busy} />

                    {submitting && (
                        <div className="fx-upload" aria-live="polite">
                            <div className="fx-upload-head">
                                <span>{uploadPct < 100 ? 'Uploading' : 'Upload finished, starting the job'}</span>
                                <span>{uploadPct}%</span>
                            </div>
                            <div
                                className="processing-bar"
                                role="progressbar"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={uploadPct}
                                aria-label="Upload progress"
                            >
                                <div className="processing-bar-fill" style={{ width: `${uploadPct}%` }} />
                            </div>
                            <button type="button" className="forma-btn fx-upload-cancel" onClick={handleCancelUpload}>
                                Cancel upload
                            </button>
                        </div>
                    )}

                    {error && <p className="fx-error">{error}</p>}

                    {/* Hidden while a job runs: the progress card takes over then. */}
                    {!isJobRunning && (
                        <p className="fx-hint">
                            We pull evenly spaced frames from across each whole file, skip blurry and
                            duplicate ones, and feed them straight into the reconstruction pipeline.
                            Higher fps = more frames = slower, more detailed scans.
                        </p>
                    )}
                </form>

                {isJobRunning && (
                    <div ref={progressCardRef} className="forma-card fx-card processing-embedded">
                        <div className="processing-card">
                            <div className="processing-main">
                                <div className="eyebrow eyebrow-accent">Reconstruction</div>
                                <h2 className="processing-title">Building your 3D model</h2>
                                <p className="processing-hint">
                                    Extracting frames from your files, then running COLMAP and Brush on
                                    the server. This takes a few minutes depending on the media.
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
                                        {phaseIndex >= 0 && <span>Step {phaseIndex + 1} of {phases.length}</span>}
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
                                    {mediaItems[0]
                                        ? <MediaPreview item={mediaItems[0]} />
                                        : <span className="processing-preview-icon"><Icon name="video" size={34} /></span>}
                                    <span className="processing-scan" aria-hidden="true"></span>
                                    <span className="processing-corner processing-corner-tl"></span>
                                    <span className="processing-corner processing-corner-tr"></span>
                                    <span className="processing-corner processing-corner-bl"></span>
                                    <span className="processing-corner processing-corner-br"></span>
                                    <span className="processing-chip">
                                        <Icon name={job.imageCount != null ? 'image' : 'play'} size={12} />
                                        {job.imageCount != null
                                            ? ` ${job.imageCount} frames`
                                            : ` ${mediaItems.length} file${mediaItems.length === 1 ? '' : 's'}`}
                                    </span>
                                </div>

                                <ol className="processing-steps">
                                    {phases.map((phaseKey, index) => {
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
                    <div className="forma-card fx-card">
                        <div>
                            <div className="eyebrow">Progress</div>
                            <h2 className="fx-card-title">{isJobDone ? 'Extracted frames' : isJobCancelled ? 'Cancelled' : 'Something went wrong'}</h2>
                        </div>

                        <div className="fx-status">
                            <div className="fx-status-head">
                                <span className={`fx-badge fx-badge-${job.status}`}>{job.status}</span>
                                <span className="fx-phase">
                                    {isJobDone ? 'Done' : isJobCancelled ? 'Cancelled. Press Process media to start again.' : job.detail || phaseLabel}
                                </span>
                                {job.imageCount != null && (
                                    <span className="fx-frames">{job.imageCount} frames</span>
                                )}
                            </div>

                            {job.error && <p className="fx-error">{job.error}</p>}

                            {isJobDone && extractedFrames.length > 0 && (
                                <div className="fx-frame-grid">
                                    {extractedFrames.slice(0, FRAME_PREVIEW_COUNT).map((frame) => (
                                        <img key={frame.name} src={frame.url} alt={frame.name} loading="lazy" />
                                    ))}
                                </div>
                            )}
                            {isJobDone && extractedFrames.length > FRAME_PREVIEW_COUNT && (
                                <p className="fx-hint">
                                    Showing {FRAME_PREVIEW_COUNT} of {extractedFrames.length} frames. The rest are in the Media Library.
                                </p>
                            )}

                            {isJobDone && (
                                <a className="forma-btn forma-btn-primary fx-download" href={`/jobs/${job.id}/result.ply`}>
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

export default FrameExtractor;
