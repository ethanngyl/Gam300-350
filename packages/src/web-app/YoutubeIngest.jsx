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
the backend, then polls job status until reconstruction finishes,
showing phase, progress, and a download link for the resulting .ply.
Also frees an in-progress server-side job if the user navigates away or
closes the tab before it completes. The submit, polling and cleanup
logic is unchanged; the markup was redesigned to the GENESIS theme
(page heading, link form card, status card with a pipeline step tracker).
An optional onBack prop adds a "Back to dashboard" button to the heading.
**************************************************************************/

import { useCallback, useEffect, useRef, useState } from 'react';
import { playSound } from '../audio/Audio.js';
import './YoutubeIngest.css';

const YT_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);

function normalizeYoutubeUrl(input) {
    const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    let u;
    try {
        u = new URL(withScheme);
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
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? withScheme : null;
}

const FINISHED = ['done', 'error', 'cancelled'];

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

const PHASE_ORDER = [
    'extract',
    'colmap-features',
    'colmap-matching',
    'colmap-mapping',
    'training',
    'normalize',
];

function YoutubeIngest({ onBack }) {
    const [url, setUrl] = useState('');
    const [fps, setFps] = useState(2);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [job, setJob] = useState(null);
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
                    }
                } catch (err) {
                    setError(`Lost contact with the server: ${err.message}`);
                    stopPolling();
                }
            }, 1500);
        },
        [stopPolling],
    );

    async function handleSubmit(e) {
        e.preventDefault();
        playSound('click');
        setError(null);

        const trimmed = normalizeYoutubeUrl(url.trim());
        if (!trimmed) {
            setError('Please enter a link to a single YouTube video (not a playlist or channel).');
            return;
        }

        setSubmitting(true);
        setJob(null);
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
    const phaseIndex = job ? PHASE_ORDER.indexOf(job.phase) : -1;

    function stepState(index) {
        if (job && job.status === 'done') return 'done';
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
                {onBack && (
                    <button
                        className="forma-btn yt-back"
                        onClick={() => {
                            playSound('click3');
                            onBack();
                        }}
                    >
                        Back to dashboard
                    </button>
                )}
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
                            onChange={(e) => setUrl(e.target.value)}
                            disabled={busy}
                            aria-label="YouTube video link"
                        />
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

                <div className="forma-card yt-card">
                    <div>
                        <div className="eyebrow">Progress</div>
                        <h2 className="yt-card-title">Extraction status</h2>
                    </div>

                    {!job && (
                        <div className="yt-empty">
                            No extraction running. Paste a link and extract frames to see
                            progress here.
                        </div>
                    )}

                    {job && (
                        <div className="yt-status">
                            <div className="yt-status-head">
                                <span className={`yt-badge yt-badge-${job.status}`}>{job.status}</span>
                                <span className="yt-phase">{job.detail || phaseLabel}</span>
                                {job.imageCount != null && (
                                    <span className="yt-frames">{job.imageCount} frames</span>
                                )}
                            </div>

                            <div className="yt-bar" aria-hidden="true">
                                <div className="yt-bar-fill" style={{ width: `${pct}%` }} />
                            </div>

                            <ol className="yt-steps">
                                {PHASE_ORDER.map((phaseKey, index) => (
                                    <li key={phaseKey} className={`yt-step yt-step-${stepState(index)}`}>
                                        <span className="yt-step-dot"></span>
                                        {PHASE_LABELS[phaseKey]}
                                    </li>
                                ))}
                            </ol>

                            {job.error && <p className="yt-error">{job.error}</p>}

                            {job.status === 'done' && (
                                <a className="forma-btn forma-btn-primary yt-download" href={`/jobs/${job.id}/result.ply`}>
                                    Download result (.ply)
                                </a>
                            )}

                            {Array.isArray(job.logTail) && job.logTail.length > 0 && (
                                <pre className="yt-log">{job.logTail.join('\n')}</pre>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default YoutubeIngest;