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
Lets the user submit a YouTube video link and frame-extraction rate to
the backend, then polls job status until reconstruction
finishes. A thumbnail of the video shows under the link once it is
valid. The status card only appears while a job exists: a simple
progress bar while it runs, then the extracted frames and a download
link for the resulting .ply once it is done. Also frees an in-progress
server-side job if the user navigates away or closes the tab before it
completes. There is no Back button; the sidebar handles navigation.
**************************************************************************/

import { useCallback, useEffect, useRef, useState } from 'react';
import { playSound } from '../audio/Audio.js';
import NameModelPrompt from './NameModelPrompt.jsx';
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

const PHASE_LABELS = {
    extract: 'Extracting frames',
    'colmap-features': 'Detecting features',
    'colmap-matching': 'Matching images',
    'colmap-mapping': 'Recovering camera poses',
    training: 'Training gaussian splat',
    normalize: 'Framing the model',
    done: 'Done',
    upload: 'Preparing',
};

function YoutubeIngest() {
    const [url, setUrl] = useState('');
    const [fps, setFps] = useState(2);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [job, setJob] = useState(null);
    const [extractedFrames, setExtractedFrames] = useState([]);
    const [hasThumbnailFailed, setHasThumbnailFailed] = useState(false);
    // Set when training finishes, to ask for the model's name.
    const [namePromptJobId, setNamePromptJobId] = useState(null);
    const jobRef = useRef(null);
    const pollRef = useRef(null);

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
            pollRef.current = setInterval(async () => {
                try {
                    const res = await fetch(`/jobs/${id}`);
                    if (!res.ok) throw new Error(`Status ${res.status}`);
                    const data = await parseJson(res);
                    setJob(data);
                    if (FINISHED.includes(data.status)) {
                        stopPolling();
                        if (data.status === 'done') {
                            setNamePromptJobId(id);
                            loadExtractedFrames(id);
                        }
                    }
                } catch (err) {
                    setError(`Lost contact with the server: ${err.message}`);
                    stopPolling();
                }
            }, 1500);
        },
        [stopPolling, loadExtractedFrames],
    );

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
                body: JSON.stringify({ url: trimmed, fps: Number(fps) || undefined }),
            });
            const data = await parseJson(res);
            if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
            setJob({ id: data.id, status: 'running', phase: 'extract', progress: 0 });
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
    const isJobFailed = job && (job.status === 'error' || job.status === 'cancelled');

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
                <div className="forma-card yt-card">
                    <div>
                        <div className="eyebrow">Video source</div>
                        <h2 className="yt-card-title">Paste a YouTube link</h2>
                    </div>

                    <form className="yt-form" onSubmit={handleSubmit}>
                        <input
                            type="url"
                            className="yt-input"
                            placeholder="https://www.youtube.com/watch?v=..."
                            value={url}
                            onChange={(e) => {
                                setUrl(e.target.value);
                                setHasThumbnailFailed(false);
                            }}
                            disabled={busy}
                            aria-label="YouTube video link"
                        />

                        {videoId && !hasThumbnailFailed && (
                            <div className="yt-preview">
                                <img
                                    src={youtubeThumbnailUrl(videoId)}
                                    alt="Thumbnail of the linked video"
                                    onError={() => setHasThumbnailFailed(true)}
                                />
                            </div>
                        )}

                        <div className="yt-row">
                            <label className="yt-fps">
                                fps
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
                            </label>
                            <button type="submit" className="forma-btn forma-btn-primary yt-submit" disabled={busy || !url.trim()}>
                                {busy ? 'Working...' : 'Extract frames'}
                            </button>
                        </div>
                        <p className="yt-hint">
                            We pull evenly spaced frames from across the whole video (up to 20 minutes),
                            skip blurry and duplicate ones, and feed them straight into the reconstruction
                            pipeline. Higher fps = more frames = slower, more detailed scans.
                        </p>
                    </form>

                    {error && <p className="yt-error">{error}</p>}
                </div>

                {job && (
                    <div className="forma-card yt-card">
                        <div>
                            <div className="eyebrow">Progress</div>
                            <h2 className="yt-card-title">{isJobDone ? 'Extracted frames' : 'Extraction status'}</h2>
                        </div>

                        <div className="yt-status">
                            <div className="yt-status-head">
                                <span className={`yt-badge yt-badge-${job.status}`}>{job.status}</span>
                                <span className="yt-phase">{isJobDone ? 'Done' : job.detail || phaseLabel}</span>
                                {job.imageCount != null && (
                                    <span className="yt-frames">{job.imageCount} frames</span>
                                )}
                            </div>

                            {!isJobDone && !isJobFailed && (
                                <div
                                    className="yt-bar"
                                    role="progressbar"
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={pct}
                                    aria-label="Extraction progress"
                                >
                                    <div className="yt-bar-fill" style={{ width: `${pct}%` }} />
                                </div>
                            )}

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