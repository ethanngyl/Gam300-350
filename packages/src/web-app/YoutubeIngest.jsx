import { useCallback, useEffect, useRef, useState } from 'react';
import './YoutubeIngest.css';

// Rough client-side check so we can give instant feedback before hitting the
// server (the server validates again authoritatively).
const YT_RE = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i;

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
            '(cd server && npm start) on port 3001.',
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
    done: 'Done',
    upload: 'Preparing',
};

function YoutubeIngest() {
    const [url, setUrl] = useState('');
    const [fps, setFps] = useState(2);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [job, setJob] = useState(null); // latest status payload from the server

    // Holds the polling interval id so we can clear it on unmount / completion.
    const pollRef = useRef(null);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    // Clean up any in-flight polling when the component unmounts.
    useEffect(() => stopPolling, [stopPolling]);

    const pollJob = useCallback(
        (id) => {
            stopPolling();
            pollRef.current = setInterval(async () => {
                try {
                    const res = await fetch(`/api/jobs/${id}`);
                    if (!res.ok) throw new Error(`Status ${res.status}`);
                    const data = await parseJson(res);
                    setJob(data);
                    if (data.status === 'done' || data.status === 'error') {
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

        const trimmed = url.trim();
        if (!YT_RE.test(trimmed)) {
            setError('Please enter a valid YouTube link (youtube.com or youtu.be).');
            return;
        }

        setSubmitting(true);
        setJob(null);
        try {
            const res = await fetch('/api/jobs/from-youtube', {
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

    const busy = submitting || (job && job.status !== 'done' && job.status !== 'error');
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
                    We pull evenly spaced frames from the video and feed them straight into the
                    reconstruction pipeline. Higher fps = more frames = slower, more detailed scans.
                </p>
            </form>

            {error && <p className="yt-error">{error}</p>}

            {job && (
                <div className="yt-status">
                    <div className="yt-status-head">
                        <span className={`yt-badge yt-badge-${job.status}`}>{job.status}</span>
                        <span className="yt-phase">{phaseLabel}</span>
                        {job.imageCount != null && (
                            <span className="yt-frames">{job.imageCount} frames</span>
                        )}
                    </div>

                    <div className="yt-bar" aria-hidden="true">
                        <div className="yt-bar-fill" style={{ width: `${pct}%` }} />
                    </div>

                    {job.error && <p className="yt-error">{job.error}</p>}

                    {job.status === 'done' && (
                        <a className="btn btn-primary yt-download" href={`/api/jobs/${job.id}/result.ply`}>
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
