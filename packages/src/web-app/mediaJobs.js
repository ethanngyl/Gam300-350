/*!************************************************************************
\file mediaJobs.js
\author1 Ethan Ng Yong Le
\author2 Bryan Lim Jun Jie
\par DP email1: n.ethanyongle@digipen.edu
\par DP email2: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Helpers for building a model from videos / animated GIFs, shared by the
Frame Extractor page (FrameExtractor.jsx, which checks the chosen files)
and App.jsx (which uploads them and shows the build on the processing
screen). Moved out of FrameExtractor.jsx unchanged.
- MEDIA_EXT_RE / MAX_MEDIA_FILES / MAX_MEDIA_SIZE_MB / MEDIA_ACCEPT
Which files can be sent (same rules as the backend).
- formatFileSize(bytes)
"12.4 MB" / "1.2 GB".
- uploadMedia(files, { fps, trainIters, removeBackground }, onStart, onProgress)
POST /jobs/from-media with XMLHttpRequest (fetch can't report upload
progress). onStart gets the request so it can be aborted. Resolves with
the new job's id; rejects with a readable error, or { aborted: true }.
**************************************************************************/

// Same rules as the backend (MEDIA_EXT_RE, maxMediaFiles and maxMediaSizeMB in
// server.js / config.js), checked here so a bad file isn't uploaded for nothing.
export const MEDIA_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpe?g|gif)$/i;
export const MAX_MEDIA_FILES = 10;
export const MAX_MEDIA_SIZE_MB = 2048;
// Browsers don't list every video type under video/*, so name the extras.
export const MEDIA_ACCEPT = 'video/*,image/gif,.mkv,.avi';

const SERVER_UNREACHABLE =
    "Couldn't reach the reconstruction server. Make sure it's running " +
    '(cd packages/src/backend && node server.js) on port 5005.';

// Sends the files with XMLHttpRequest, because fetch can't report upload
// progress and a video can take a while. onStart receives the request, so
// Cancel can abort it. Resolves with the new job's id; rejects with a readable
// error, or with { aborted: true } when it was cancelled.
export function uploadMedia(files, { fps, trainIters, removeBackground }, onStart, onProgress) {
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

export function formatFileSize(bytes) {
    const megabytes = bytes / (1024 * 1024);
    return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes.toFixed(1)} MB`;
}