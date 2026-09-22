import { useCallback, useEffect, useRef, useState } from 'react';
import './YoutubeIngest.css';

// Client-side check for instant feedback; mirrors canonicalYoutubeUrl() in the
// backend's pipeline.js, which validates again authoritatively. Accepts a
// single video only (watch?v=, youtu.be/, shorts/, embed/, live/).
const YT_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);

// Returns the URL to submit (scheme added if the user left it off), or null.
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

// Parse a response as JSON, but turn the browser's cryptic
// "Failed to execute 'json' on 'Response'" into an actionable message. That
// error means the body wasn't JSON — usually because the reconstruction
// backend isn't running and the dev proxy returned an error page instead.
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

// Human-readable labels for the pipeline phases the backend reports.
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
    const [job, setJob] = useState(null); // latest status payload from the server
    // Keep a ref copy of the current job for the leave-handlers (see below).
    const jobRef = useRef(null);

    // Holds the polling interval id so we can clear it on unmount / completion.
    const pollRef = useRef(null);

    // Mirror the latest job into jobRef so the leave-handlers below can read it
    // without re-subscribing every render.
    useEffect(() => {
        jobRef.current = job;
    }, [job]);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    // Clean up any in-flight polling when the component unmounts.
    useEffect(() => stopPolling, [stopPolling]);

    // Free a still-running server-side job when the user leaves this page:
    // "Back to dashboard", closing the tab, or refreshing all unmount this
    // component while COLMAP/Brush keeps running unwatched. A finished job is
    // left alone so its result stays downloadable, and the backend's DELETE is
    // idempotent, so an extra call is harmless. keepalive lets the request
    // finish during page unload.
    useEffect(() => {
        function killJob() {
            const j = jobRef.current;
            if (!j || !j.id || FINISHED.includes(j.status)) return;
            fetch(`/jobs/${j.id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
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

    return (
        <div className="yt">
            <form className="yt-form" onSubmit={handleSubmit}>
                <div className="yt-row">
                    <input
                        type="url"
                        className="yt-input"
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        disabled={busy}
                        aria-label="YouTube video link"
                    />
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
                    <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>
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

                    {job.error && <p className="yt-error">{job.error}</p>}

                    {job.status === 'done' && (
                        <a className="btn btn-primary yt-download" href={`/jobs/${job.id}/result.ply`}>
                            Download result (.ply)
                        </a>
                    )}

                    {Array.isArray(job.logTail) && job.logTail.length > 0 && (
                        <pre className="yt-log">{job.logTail.join('\n')}</pre>
                    )}
                </div>
            )}
        </div>
    );
}

export default YoutubeIngest;
