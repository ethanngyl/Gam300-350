/*!************************************************************************
\file VideoJobs.js
\author1 Ethan Ng Yong Le
\author2 Bryan Lim Jun Jie
\par DP email1: n.ethanyongle@digipen.edu
\par DP email2: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Helpers for building a model from a video, shared by the Video Extractor
page (YoutubeIngest.jsx, which checks the link or file) and App.jsx (which
starts the job and shows its progress on the processing screen).
- youtubeVideoId(input) / normalizeYoutubeUrl(input) / youtubeThumbnailUrl(id)
Read a single-video YouTube link (not a playlist or channel).
- MAX_VIDEO_MB / videoFileProblem(file) / formatFileSize(bytes)
Check a chosen .mp4 before it is sent.
- startYoutubeJob({ url, fps, trainIters })
POST /jobs/from-youtube. Resolves with the new job's id.
- startVideoFileJob({ file, fps, trainIters }, onProgress)
Uploads the .mp4 to POST /jobs/from-video with XMLHttpRequest, since fetch
can't report upload progress. Returns { promise, abort }: promise resolves
with the job's id, or rejects with an AbortError if abort() was called.
The server deletes the video as soon as its frames are extracted.
**************************************************************************/

const YT_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);

function withHttpsScheme(input) {
    return /^https?:\/\//i.test(input) ? input : `https://${input}`;
}

// The 11-character video id from a single-video link, or null.
export function youtubeVideoId(input) {
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

export function normalizeYoutubeUrl(input) {
    return youtubeVideoId(input) ? withHttpsScheme(input) : null;
}

export function youtubeThumbnailUrl(videoId) {
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

// Largest .mp4 accepted. Keep in step with the backend's maxVideoSizeMB
// (config.js, MAX_VIDEO_MB); the server checks again either way.
export const MAX_VIDEO_MB = 1024;

// Why a chosen file can't be sent, or null if it can.
export function videoFileProblem(file) {
    if (!file) return 'Please choose an .mp4 video file.';
    if (!/\.mp4$/i.test(file.name)) return 'Only .mp4 videos are supported.';
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) return `That video is too large -- it must be under ${MAX_VIDEO_MB} MB.`;
    return null;
}

// "12.4 MB" for the chosen file.
export function formatFileSize(bytes) {
    return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function parseJsonText(text) {
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            "Couldn't reach the reconstruction server. Make sure it's running " +
            '(cd packages/src/backend && node server.js) on port 5005.',
        );
    }
}

export async function startYoutubeJob({ url, fps, trainIters }) {
    const res = await fetch('/jobs/from-youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, fps: Number(fps) || undefined, trainIters }),
    });
    const data = parseJsonText(await res.text());
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data.id;
}

export function startVideoFileJob({ file, fps, trainIters }, onProgress) {
    const xhr = new XMLHttpRequest();

    const promise = new Promise((resolve, reject) => {
        const form = new FormData();
        // Fields before the file, so the server has them before the upload ends.
        if (Number(fps) > 0) form.append('fps', String(Number(fps)));
        form.append('trainIters', String(trainIters));
        form.append('video', file);

        xhr.open('POST', '/jobs/from-video');
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) onProgress(event.loaded / event.total);
        };
        xhr.onload = () => {
            try {
                const data = parseJsonText(xhr.responseText);
                if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.error || `Request failed (${xhr.status})`);
                resolve(data.id);
            } catch (err) {
                reject(err);
            }
        };
        xhr.onerror = () => reject(new Error("Couldn't upload the video. Check your connection and try again."));
        xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
        xhr.send(form);
    });

    return { promise, abort: () => xhr.abort() };
}