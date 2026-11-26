/*!************************************************************************
\file AddPhotosDialog.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
The "New model" dialog, opened by New in the sidebar, Home's Add photos
card and Upload photos button. Laid out like the Figma, in two steps:
1. "Add source photos": a drop area with Browse files, plus "Choose from
   Media Library" (LibraryPhotoPicker.jsx) to reuse photos already
   uploaded, and "Capture with camera" (not in the Figma; it keeps the
   camera reachable from New). Choosing photos moves on at once.
2. "Photos added": the first photo with the count, a quick check of the
   photos (the Photo Editor's checks, PhotoChecks.js), Auto-fix, Remove
   background (on, as recommended), then Edit manually (opens the Photo
   Editor) or Render now (starts the build in the background).
Auto-fix leaves out blurry and near-duplicate photos (unless that would
leave too few) and evens out the brightness of too-dark and too-bright
ones, using the Photo Editor's Auto fix brightness, worked out for each of
the two groups on its own.
Escape, the X and a click outside close it.
- AddPhotosDialog({ onEditManually, onRenderNow, onOpenCamera, onClose })
React component. onEditManually(files, settings) and onRenderNow(files,
settings) get the photos and { removeBackground }.
**************************************************************************/

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import LibraryPhotoPicker from './LibraryPhotoPicker.jsx';
import { analyzePhoto, findPhotoIssues } from './PhotoChecks.js';
import { computeAutoFix, exportEditedFile, DEFAULT_EDITS } from './PhotoEdits.js';
import { catalog } from './catalog.js';
import { playSound } from '../audio/Audio.js';
import './AddPhotosDialog.css';

const MIN_PHOTOS = catalog.minPhotos;
// Issues Auto-fix handles by leaving the photo out, and by adjusting it.
const LEAVE_OUT_ISSUES = ['blurry', 'duplicate'];
const ADJUST_ISSUES = ['dark', 'bright'];

function isImageFile(file) {
    return file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(file.name);
}

function photoCountText(count) {
    return `${count} photo${count === 1 ? '' : 's'}`;
}

function AddPhotosDialog({ onEditManually, onRenderNow, onOpenCamera, onClose }) {
    // 'choose' (step 1) or 'review' (step 2).
    const [step, setStep] = useState('choose');
    const [isDragging, setIsDragging] = useState(false);
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    // The photos to build from: [{ id, file, analysisStatus, analysis }].
    const [photos, setPhotos] = useState([]);
    const [removeBackground, setRemoveBackground] = useState(true);
    // null, 'working', or { fixedCount } once Auto-fix has run.
    const [autoFixState, setAutoFixState] = useState(null);
    const fileInputRef = useRef(null);
    const nextPhotoIdRef = useRef(1);

    // The first photo, shown large in step 2; freed when it changes or on close.
    const firstFile = photos[0]?.file ?? null;
    const previewUrl = useMemo(() => (firstFile ? URL.createObjectURL(firstFile) : null), [firstFile]);
    useEffect(() => () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);

    // Escape closes the dialog (the library picker handles its own).
    useEffect(() => {
        if (isLibraryOpen) return undefined;
        function closeOnEscape(event) {
            if (event.key === 'Escape') onClose();
        }
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [onClose, isLibraryOpen]);

    // Checks each photo once, one at a time, so the page stays responsive.
    const pendingIds = photos.filter((photo) => photo.analysisStatus === 'pending').map((photo) => photo.id).join(',');
    useEffect(() => {
        if (!pendingIds) return undefined;
        let isCancelled = false;
        const photoId = Number(pendingIds.split(',')[0]);
        const photo = photos.find((entry) => entry.id === photoId);

        analyzePhoto(photo.file)
            .then((analysis) => ({ analysisStatus: 'done', analysis }))
            .catch(() => ({ analysisStatus: 'failed', analysis: null }))
            .then((result) => {
                if (isCancelled) return;
                setPhotos((current) => current.map((entry) => (entry.id === photoId ? { ...entry, ...result } : entry)));
            });
        return () => { isCancelled = true; };
        // photos is read only for the one being checked; pendingIds decides when to run.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingIds]);

    function addFiles(fileList) {
        const images = Array.from(fileList ?? []).filter(isImageFile);
        if (images.length === 0) return;
        playSound('tap');
        setPhotos((current) => [
            ...current,
            ...images.map((file) => ({ id: nextPhotoIdRef.current++, file, analysisStatus: 'pending', analysis: null })),
        ]);
        setAutoFixState(null);
        setStep('review');
    }

    function handleFileInputChange(event) {
        addFiles(event.target.files);
        // Clear so choosing the same photos again still fires onChange.
        event.target.value = '';
    }

    function handleDrop(event) {
        event.preventDefault();
        setIsDragging(false);
        addFiles(event.dataTransfer.files);
    }

    const isChecking = photos.some((photo) => photo.analysisStatus === 'pending');
    const issuesById = isChecking ? {} : findPhotoIssues(photos);
    const flaggedPhotos = photos.filter((photo) => (issuesById[photo.id] ?? []).length > 0);
    const hasTooFewPhotos = photos.length < MIN_PHOTOS;

    async function autoFix() {
        playSound('tap');
        setAutoFixState('working');

        const leaveOutIds = new Set(flaggedPhotos
            .filter((photo) => issuesById[photo.id].some((issue) => LEAVE_OUT_ISSUES.includes(issue)))
            .map((photo) => photo.id));
        // Leaving them out mustn't drop the batch below the minimum.
        const canLeaveOut = photos.length - leaveOutIds.size >= MIN_PHOTOS;
        const adjustPhotos = flaggedPhotos.filter((photo) =>
            (!canLeaveOut || !leaveOutIds.has(photo.id))
            && issuesById[photo.id].some((issue) => ADJUST_ISSUES.includes(issue)));

        // Too-dark and too-bright photos get their own correction, so a bright
        // photo isn't brightened along with dark ones (or the other way round).
        const fixedFiles = new Map();
        for (const issue of ADJUST_ISSUES) {
            const groupPhotos = adjustPhotos.filter((photo) => issuesById[photo.id].includes(issue));
            const correction = computeAutoFix(groupPhotos.map((photo) => photo.analysis));
            if (!correction) continue;
            // Only ever brightens dark photos and darkens bright ones. Brightness
            // only: added contrast stretches around mid-grey, which would pull a
            // dark photo darker again (and push a bright one brighter).
            const brightness = issue === 'dark' ? Math.max(0, correction.brightness) : Math.min(0, correction.brightness);
            // Nothing to change: leave these photos flagged rather than count them as fixed.
            if (brightness === 0) continue;
            for (const photo of groupPhotos) {
                fixedFiles.set(photo.id, await exportEditedFile(photo.file, { ...DEFAULT_EDITS, brightness }));
            }
        }

        const fixedCount = (canLeaveOut ? leaveOutIds.size : 0) + fixedFiles.size;
        setPhotos((current) => current
            .filter((photo) => !canLeaveOut || !leaveOutIds.has(photo.id))
            // Fixed photos count as checked and fine: their issue was dealt with.
            .map((photo) => (fixedFiles.has(photo.id)
                ? { ...photo, file: fixedFiles.get(photo.id), analysisStatus: 'fixed' }
                : photo)));
        setAutoFixState({ fixedCount });
    }

    const files = photos.map((photo) => photo.file);
    const settings = { removeBackground };

    let statusText;
    if (isChecking) statusText = 'Checking your photos...';
    else if (hasTooFewPhotos) statusText = `Add at least ${MIN_PHOTOS} photos to build a model (you have ${photos.length}).`;
    else if (flaggedPhotos.length > 0) statusText = null;
    else statusText = 'No issues found. Your photos are ready to build.';

    const title = step === 'choose' ? 'Add source photos' : 'Photos added';

    return (
        <div className="add-photos-backdrop" onClick={onClose}>
            <div
                className={step === 'review' ? 'add-photos-dialog is-review' : 'add-photos-dialog'}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="add-photos-head">
                    <h2>{title}</h2>
                    <button type="button" className="add-photos-close" onClick={onClose} aria-label="Close">
                        <Icon name="close" size={16} />
                    </button>
                </div>

                {step === 'choose' && (
                    <div className="add-photos-body">
                        <div
                            className={isDragging ? 'add-photos-drop is-dragging' : 'add-photos-drop'}
                            onDragOver={(event) => {
                                event.preventDefault();
                                setIsDragging(true);
                            }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                        >
                            <span className="add-photos-drop-icon"><Icon name="upload" size={22} /></span>
                            <strong>Choose photos to upload</strong>
                            <p>Drag and drop files here, or browse from your device.</p>
                            <button
                                type="button"
                                className="forma-btn add-photos-browse"
                                onClick={() => {
                                    playSound('tap');
                                    fileInputRef.current?.click();
                                }}
                            >
                                <Icon name="folder" size={15} /> Browse files
                            </button>
                            <small>JPG, PNG, WEBP or HEIC, 40{'\u2013'}80 overlapping shots work best</small>
                            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFileInputChange} />
                        </div>

                        <div className="add-photos-other">
                            <span>Or start from</span>
                            <button
                                type="button"
                                className="forma-btn"
                                onClick={() => {
                                    playSound('tap');
                                    setIsLibraryOpen(true);
                                }}
                            >
                                <Icon name="image" size={15} /> Choose from Media Library
                            </button>
                            {onOpenCamera && (
                                <button
                                    type="button"
                                    className="forma-btn"
                                    onClick={() => {
                                        playSound('confirm');
                                        onOpenCamera();
                                    }}
                                >
                                    <Icon name="camera" size={15} /> Capture with camera
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {step === 'review' && (
                    <div className="add-photos-review">
                        <div className="add-photos-review-main">
                            <div className="add-photos-preview">
                                {previewUrl && <img src={previewUrl} alt="" />}
                                <span className="add-photos-count">
                                    <Icon name="image" size={13} /> {photoCountText(photos.length)}
                                </span>
                            </div>
                            <p className={flaggedPhotos.length > 0 || hasTooFewPhotos ? 'add-photos-status has-issues' : 'add-photos-status'} role="status">
                                {statusText ?? (
                                    <>
                                        <span className="add-photos-issue-count">{flaggedPhotos.length}</span>
                                        {' '}{flaggedPhotos.length === 1 ? 'photo' : 'photos'} found with issues
                                    </>
                                )}
                            </p>
                        </div>

                        <div className="add-photos-review-side">
                            <button
                                type="button"
                                className="forma-btn add-photos-autofix"
                                onClick={autoFix}
                                disabled={isChecking || flaggedPhotos.length === 0 || autoFixState !== null}
                            >
                                {autoFixState === 'working' && 'Fixing...'}
                                {autoFixState && autoFixState !== 'working' && `Auto-fixed ${photoCountText(autoFixState.fixedCount)}`}
                                {!autoFixState && 'Auto-fix'}
                            </button>

                            <label className="add-photos-check">
                                <input
                                    type="checkbox"
                                    checked={removeBackground}
                                    onChange={(event) => {
                                        playSound('tap');
                                        setRemoveBackground(event.target.checked);
                                    }}
                                />
                                <span>Remove background</span>
                            </label>
                            <p className="add-photos-tip">
                                <Icon name="help" size={13} />
                                We recommend keeping this on to render better quality models.
                            </p>

                            <div className="add-photos-review-actions">
                                <button
                                    type="button"
                                    className="forma-btn"
                                    onClick={() => {
                                        playSound('tap');
                                        onEditManually(files, settings);
                                    }}
                                >
                                    Edit manually
                                </button>
                                <button
                                    type="button"
                                    className="forma-btn forma-btn-primary"
                                    disabled={isChecking || hasTooFewPhotos || autoFixState === 'working'}
                                    onClick={() => {
                                        playSound('confirm');
                                        onRenderNow(files, settings);
                                    }}
                                >
                                    Render now
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {isLibraryOpen && (
                // Stops clicks in the picker reaching the backdrop, which would close the dialog.
                <div onClick={(event) => event.stopPropagation()}>
                    <LibraryPhotoPicker
                        onAddFiles={addFiles}
                        onClose={() => setIsLibraryOpen(false)}
                    />
                </div>
            )}
        </div>
    );
}

export default AddPhotosDialog;