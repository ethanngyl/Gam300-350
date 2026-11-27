/*!************************************************************************
\file useBackgroundBuilds.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 25-11-2026
\brief
Builds that run in the background while the user keeps using the app, as
in the Figma: the build panel (BuildPanel.jsx) in the corner shows each
one. The backend runs a build on its own once the photos are uploaded
(jobs wait their turn per user, see the backend's jobQueue.js), so leaving
a page no longer cancels it; only Cancel does.
Each build is { key, jobId, source: 'photos' | 'media', label, detail,
previewUrl, status: 'uploading' | 'queued' | 'running' | 'done' | 'error'
| 'cancelled' | 'lost', phase, progress (0-1), uploadFraction (0-1),
waitingText, error, files, settings }. 'lost' means the build can no
longer be followed from here (signed out, or the server stopped
answering); it may still be running on the server. files and settings are kept so a failed upload
can be retried or opened in the Photo Editor / Video Extractor.
The ids of builds started on this browser are saved per account, so after
a reload the panel picks up the ones still running.
Cancelling or signing out while photos are still being sent stops the
upload. Once every byte is sent the server is already making the job, so
the upload is left to finish: a cancelled build's job is then deleted, and
a signed-out account's job is saved for when it signs in again.
- useBackgroundBuilds(user)
React hook. Returns { builds, startPhotoBuild, startMediaBuild,
cancelBuild, dismissBuild, dismissJob, trackJob, isUploading }.
- BUILD_STEPS / buildStepIndex(build)
The three steps the panel lists, and which one a build is on.
**************************************************************************/

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadMedia, uploadPhotos } from '../create/mediaJobs.js';
import { playSound } from '../../audio/Audio.js';

// How long to wait after checking the running builds before checking again, in milliseconds.
const POLL_INTERVAL_MS = 2000;
// Checks in a row that can fail (server down, bad replies) before a build
// is given up on: about 30 seconds.
const MAX_FAILED_POLLS = 15;
const SESSION_ENDED_TEXT = 'Your session has ended. Sign in again to see this build in the Media Library.';
const LOST_CONTACT_TEXT = 'Lost contact with the server. The build may still be running; check the Media Library.';
const SAVED_BUILDS_KEY_PREFIX = 'genesis-builds:';

// The panel's three steps, as in the Figma, with the backend phases each
// one covers (the full list is in Processing.jsx).
export const BUILD_STEPS = [
    { id: 'align', label: 'Aligning photos', phases: ['upload', 'extract', 'masking', 'colmap-features', 'colmap-matching', 'colmap-mapping'] },
    { id: 'train', label: 'Building point cloud', phases: ['training'] },
    { id: 'finish', label: 'Finishing the model', phases: ['crop', 'normalize', 'done'] },
];

// Which of BUILD_STEPS a build is on (0-2). Uploading counts as the first.
export function buildStepIndex(build) {
    if (build.status === 'done') return BUILD_STEPS.length;
    const index = BUILD_STEPS.findIndex((step) => step.phases.includes(build.phase));
    return index === -1 ? 0 : index;
}

const FINISHED_STATUSES = new Set(['done', 'error', 'cancelled', 'lost']);

function savedBuildsKey(user) {
    return `${SAVED_BUILDS_KEY_PREFIX}${user?.email ?? 'guest'}`;
}

// The saved builds for this account: [{ jobId, label, detail, source }].
// Storage can be blocked (private windows, site data off), so every access is wrapped.
function loadSavedBuilds(user) {
    try {
        const saved = JSON.parse(window.localStorage.getItem(savedBuildsKey(user)));
        return Array.isArray(saved) ? saved.filter((entry) => typeof entry?.jobId === 'string') : [];
    } catch {
        return [];
    }
}

function saveBuilds(user, builds) {
    try {
        const running = builds
            .filter((build) => build.jobId && !FINISHED_STATUSES.has(build.status))
            .map(({ jobId, label, detail, source }) => ({ jobId, label, detail, source }));
        window.localStorage.setItem(savedBuildsKey(user), JSON.stringify(running));
    } catch {
        // Storage unavailable: the builds just aren't picked up after a reload.
    }
}

// Adds one build to an account's saved list, e.g. a job whose upload
// finished after that account signed out.
function addSavedBuild(user, entry) {
    try {
        const saved = loadSavedBuilds(user).filter((savedEntry) => savedEntry.jobId !== entry.jobId);
        window.localStorage.setItem(savedBuildsKey(user), JSON.stringify([...saved, entry]));
    } catch {
        // Storage unavailable: the build still shows in the Media Library.
    }
}

// Asks the server to stop a build. keepalive lets it finish even if the page closes.
function deleteJob(jobId) {
    fetch(`/api/v1/jobs/${jobId}`, { method: 'DELETE', keepalive: true }).catch(() => { });
}

// "12 photos, background removed" -- the line under a build's name.
function describeSettings(fileCount, unit, { removeBackground }) {
    const count = `${fileCount} ${unit}${fileCount === 1 ? '' : 's'}`;
    return removeBackground ? `${count}, background removed` : count;
}

let nextBuildKey = 1;

// The builds this account started here before a reload, to follow again.
function restoreBuilds(user) {
    if (!user) return [];
    return loadSavedBuilds(user).map((entry) => ({
        key: nextBuildKey++,
        jobId: entry.jobId,
        source: entry.source ?? 'photos',
        label: entry.label ?? 'New model',
        detail: entry.detail ?? '',
        previewUrl: null,
        status: 'queued',
        phase: null,
        progress: 0,
        uploadFraction: null,
        waitingText: null,
        error: null,
        files: null,
        settings: null,
    }));
}

export function useBackgroundBuilds(user) {
    const userKey = user?.email ?? null;
    const [builds, setBuilds] = useState(() => restoreBuilds(user));
    // Signing in as someone else (or out) swaps in that account's builds.
    // Done while rendering, as React suggests for state that follows a prop.
    const [loadedUserKey, setLoadedUserKey] = useState(userKey);
    if (loadedUserKey !== userKey) {
        setLoadedUserKey(userKey);
        setBuilds(restoreBuilds(user));
    }
    // Each upload still in progress, by build key: { owner, ownerKey,
    // isCancelled, stopSending }. stopSending aborts the request unless every
    // byte has been sent (see startBuild).
    const uploadsRef = useRef(new Map());
    // The phase last seen per build, so the tick sound plays once per step.
    const lastPhasesRef = useRef(new Map());
    // Checks in a row that failed, per build.
    const failedPollsRef = useRef(new Map());
    // The signed-in account and the current builds, for callbacks that run later.
    const userRef = useRef(user);
    const buildsRef = useRef(builds);
    useEffect(() => {
        userRef.current = user;
        buildsRef.current = builds;
    });

    // Signing out, or in as someone else: stop the uploads still sending.
    // One that has sent everything finishes, and is saved for its account.
    useEffect(() => () => {
        uploadsRef.current.forEach((upload) => upload.stopSending());
    }, [userKey]);

    const updateBuild = useCallback((key, changes) => {
        setBuilds((current) => current.map((build) => (build.key === key ? { ...build, ...changes } : build)));
    }, []);

    // Keeps the saved list in step with the running builds.
    useEffect(() => {
        if (user && loadedUserKey === userKey) saveBuilds(user, builds);
    }, [user, userKey, loadedUserKey, builds]);

    // Releases the preview images of builds that are gone.
    const previewUrls = builds.map((build) => build.previewUrl).filter(Boolean).join('|');
    const shownPreviewsRef = useRef(new Set());
    useEffect(() => {
        const nowShown = new Set(previewUrls ? previewUrls.split('|') : []);
        shownPreviewsRef.current.forEach((url) => {
            if (!nowShown.has(url)) URL.revokeObjectURL(url);
        });
        shownPreviewsRef.current = nowShown;
    }, [previewUrls]);

    // Polls every build that has a job and hasn't finished.
    const pollKey = builds
        .filter((build) => build.jobId && !FINISHED_STATUSES.has(build.status))
        .map((build) => `${build.key}:${build.jobId}`)
        .join(',');
    useEffect(() => {
        if (!pollKey) return undefined;
        const tracked = pollKey.split(',').map((entry) => {
            const [key, jobId] = entry.split(':');
            return { key: Number(key), jobId };
        });
        let isStopped = false;
        let timerId = null;

        // A check that failed. Too many in a row and the build is given up on.
        function countFailedPoll(key) {
            const failedCount = (failedPollsRef.current.get(key) ?? 0) + 1;
            failedPollsRef.current.set(key, failedCount);
            if (failedCount >= MAX_FAILED_POLLS) updateBuild(key, { status: 'lost', error: LOST_CONTACT_TEXT });
        }

        async function checkBuilds() {
            for (const { key, jobId } of tracked) {
                try {
                    const res = await fetch(`/api/v1/jobs/${jobId}`);
                    if (isStopped) return;
                    if (res.status === 404) {
                        // Deleted elsewhere: nothing left to follow.
                        setBuilds((current) => current.filter((build) => build.key !== key));
                        continue;
                    }
                    if (res.status === 401 || res.status === 403) {
                        // Signed out (e.g. the session expired): this account can't see it any more.
                        updateBuild(key, { status: 'lost', error: SESSION_ENDED_TEXT });
                        continue;
                    }
                    if (!res.ok) {
                        countFailedPoll(key);
                        continue;
                    }
                    const job = await res.json();
                    if (isStopped) return;
                    failedPollsRef.current.delete(key);

                    const lastPhase = lastPhasesRef.current.get(key);
                    if (job.status === 'running' && lastPhase && job.phase !== lastPhase) playSound('tick');
                    lastPhasesRef.current.set(key, job.phase);
                    if (job.status === 'done') playSound('success');
                    if (job.status === 'error') playSound('error');

                    const changes = {
                        status: job.status,
                        phase: job.phase,
                        progress: job.progress ?? 0,
                        waitingText: job.status === 'queued' ? job.detail ?? null : null,
                        error: job.status === 'error' ? job.error || 'Reconstruction failed' : null,
                    };
                    // Renamed while building: show the new name.
                    if (job.name) changes.label = job.name;
                    updateBuild(key, changes);
                } catch {
                    // Server unreachable for a moment: try again next time.
                    if (isStopped) return;
                    countFailedPoll(key);
                }
            }
            // The next check is only scheduled once this one has finished, so
            // a slow server can't make two run at once (and play a sound twice).
            if (!isStopped) timerId = setTimeout(checkBuilds, POLL_INTERVAL_MS);
        }

        checkBuilds();
        return () => {
            isStopped = true;
            clearTimeout(timerId);
        };
    }, [pollKey, updateBuild]);

    // Adds a build and uploads it with upload(onStart, onProgress), which
    // resolves with the new job's id.
    const startBuild = useCallback((entry, upload) => {
        const key = nextBuildKey++;
        setBuilds((current) => [...current, {
            key,
            jobId: null,
            status: 'uploading',
            phase: 'upload',
            progress: 0,
            uploadFraction: 0,
            waitingText: null,
            error: null,
            ...entry,
        }]);

        let lastPercent = 0;
        const owner = userRef.current;
        const thisUpload = { owner, ownerKey: owner?.email ?? null, isCancelled: false, stopSending: () => { } };
        uploadsRef.current.set(key, thisUpload);
        upload(
            (xhr) => {
                // Once every byte is sent the server is making the job, and
                // aborting would lose the reply with its id, leaving the job
                // running unseen. So from then on the upload is left to finish
                // (the reply is handled below).
                let hasSentAllBytes = false;
                xhr.upload.addEventListener('load', () => {
                    hasSentAllBytes = true;
                });
                thisUpload.stopSending = () => {
                    if (!hasSentAllBytes) xhr.abort();
                };
            },
            (fraction) => {
                // Only re-render when the shown percentage changes.
                const percent = Math.round(fraction * 100);
                if (percent === lastPercent) return;
                lastPercent = percent;
                updateBuild(key, { uploadFraction: percent / 100 });
            },
        )
            .then((jobId) => {
                if (thisUpload.isCancelled) {
                    // Cancelled while the upload was finishing: stop the job it made.
                    deleteJob(jobId);
                    return;
                }
                if (thisUpload.ownerKey !== (userRef.current?.email ?? null)) {
                    // Signed out while it finished: keep it for that account's next sign-in.
                    if (owner) addSavedBuild(owner, { jobId, label: entry.label, detail: entry.detail, source: entry.source });
                    return;
                }
                lastPhasesRef.current.set(key, 'upload');
                updateBuild(key, { jobId, status: 'queued', uploadFraction: null });
            })
            .catch((err) => {
                // Cancelled, or signed out: the build was already taken off the list.
                if (err?.aborted || thisUpload.isCancelled || thisUpload.ownerKey !== (userRef.current?.email ?? null)) return;
                playSound('error');
                updateBuild(key, { status: 'error', error: err.message || 'Upload failed', uploadFraction: null });
            })
            .finally(() => uploadsRef.current.delete(key));
        return key;
    }, [updateBuild]);

    // A photo batch: { removeBackground, autoCrop, trainIters }.
    const startPhotoBuild = useCallback((files, settings = {}) => startBuild({
        source: 'photos',
        label: 'New model',
        detail: describeSettings(files.length, 'photo', settings),
        previewUrl: files[0] ? URL.createObjectURL(files[0]) : null,
        files,
        settings,
    }, (onStart, onProgress) => uploadPhotos(files, settings, onStart, onProgress)), [startBuild]);

    // Videos / GIFs from the Video Extractor: { fps, trainIters, removeBackground, autoCrop }.
    const startMediaBuild = useCallback((files, settings) => startBuild({
        source: 'media',
        label: files.length === 1 ? files[0].name : 'New model',
        detail: describeSettings(files.length, 'video', settings),
        previewUrl: null,
        files,
        settings,
    }, (onStart, onProgress) => uploadMedia(files, settings, onStart, onProgress)), [startBuild]);

    // Follows a build started elsewhere (e.g. a #/processing/<id> link).
    const trackJob = useCallback((jobId) => {
        setBuilds((current) => {
            if (current.some((build) => build.jobId === jobId)) return current;
            return [...current, {
                key: nextBuildKey++,
                jobId,
                source: 'photos',
                label: 'New model',
                detail: '',
                previewUrl: null,
                status: 'queued',
                phase: null,
                progress: 0,
                uploadFraction: null,
                waitingText: null,
                error: null,
                files: null,
                settings: null,
            }];
        });
    }, []);

    // Stops a build: stops its upload, or asks the server to cancel the job.
    // (The request is sent here, not inside setBuilds, which React may run twice.)
    const cancelBuild = useCallback((key) => {
        const build = buildsRef.current.find((entry) => entry.key === key);
        if (build?.jobId && !FINISHED_STATUSES.has(build.status)) deleteJob(build.jobId);
        const thisUpload = uploadsRef.current.get(key);
        if (thisUpload) {
            thisUpload.isCancelled = true;
            thisUpload.stopSending();
        }
        setBuilds((current) => current.filter((entry) => entry.key !== key));
    }, []);

    // Takes a finished build off the panel.
    const dismissBuild = useCallback((key) => {
        setBuilds((current) => current.filter((build) => build.key !== key));
    }, []);

    // Takes a build off the panel by its job id, e.g. once its Details screen has opened the model.
    const dismissJob = useCallback((jobId) => {
        setBuilds((current) => current.filter((build) => build.jobId !== jobId));
    }, []);

    const isUploading = builds.some((build) => build.status === 'uploading');

    // While anything is uploading, the browser asks before a refresh or
    // closing the tab, which would stop the upload.
    useEffect(() => {
        if (!isUploading) return undefined;
        function askBeforeLeaving(event) {
            event.preventDefault();
        }
        window.addEventListener('beforeunload', askBeforeLeaving);
        return () => window.removeEventListener('beforeunload', askBeforeLeaving);
    }, [isUploading]);

    return { builds, startPhotoBuild, startMediaBuild, cancelBuild, dismissBuild, dismissJob, trackJob, isUploading };
}