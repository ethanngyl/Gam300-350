/*!************************************************************************
\file PhotoEditorScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-10-2026
\brief
Photo Editor tab: a simple "check and prepare" step before reconstruction.
The user adds photos from their device; each one is checked in the
browser for blur, bad exposure and near-duplicates, and flagged photos
can be left out individually or all at once. Brightness and contrast
apply to every photo equally so the batch stays consistent. "Generate 3D
model" uploads only the kept photos through onGenerateModel (App's
handleBatchReady). On desktop, clicking a photo shows a large preview;
on phones, tapping a photo toggles it and only brightness is offered.
**************************************************************************/

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';
import {
    analyzePhoto,
    applyAdjustments,
    buildPreviewFilter,
    findPhotoIssues,
    ISSUE_EXPLANATIONS,
    ISSUE_LABELS,
} from './PhotoChecks.js';
import './PhotoEditor.css';

// Fewest kept photos allowed before building a model (matches capture).
const MIN_PHOTOS = 8;
// Same breakpoint as the phone layout in AppTheme.css.
const PHONE_MEDIA_QUERY = '(max-width: 760px)';

let nextPhotoNumber = 0;

// True on phone-sized screens; updates when the window is resized.
function useIsPhone() {
    const [isPhone, setIsPhone] = useState(() => window.matchMedia(PHONE_MEDIA_QUERY).matches);

    useEffect(() => {
        const mediaQueryList = window.matchMedia(PHONE_MEDIA_QUERY);
        function handleChange(event) {
            setIsPhone(event.matches);
        }
        mediaQueryList.addEventListener('change', handleChange);
        return () => mediaQueryList.removeEventListener('change', handleChange);
    }, []);

    return isPhone;
}

function PhotoEditorScreen({ onGenerateModel, uploadError }) {
    const isPhone = useIsPhone();
    const fileInputRef = useRef(null);
    // Id of the photo currently being checked, so only one runs at a time.
    const analyzingPhotoIdRef = useRef(null);
    // Latest photo list, read when the screen closes to release preview URLs.
    const photosRef = useRef([]);

    const [photos, setPhotos] = useState([]);
    const [selectedPhotoId, setSelectedPhotoId] = useState(null);
    const [brightness, setBrightness] = useState(0);
    const [contrast, setContrast] = useState(0);
    const [isShowingOriginal, setIsShowingOriginal] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    // How many photos have been prepared for upload; null when not uploading.
    const [preparedCount, setPreparedCount] = useState(null);

    useEffect(() => {
        photosRef.current = photos;
    }, [photos]);

    // Release every preview URL when the editor closes.
    useEffect(() => {
        return () => {
            photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
        };
    }, []);

    // Check pending photos one at a time. Each finished check updates the
    // list, which re-runs this effect and starts the next one.
    useEffect(() => {
        if (analyzingPhotoIdRef.current) return;

        const pendingPhoto = photos.find((photo) => photo.analysisStatus === 'pending');
        if (!pendingPhoto) return;

        analyzingPhotoIdRef.current = pendingPhoto.id;
        analyzePhoto(pendingPhoto.file)
            .then((analysis) => ({ analysisStatus: 'done', analysis }))
            .catch(() => ({ analysisStatus: 'failed', analysis: null }))
            .then((checkResult) => {
                analyzingPhotoIdRef.current = null;
                setPhotos((currentPhotos) =>
                    currentPhotos.map((photo) =>
                        photo.id === pendingPhoto.id ? { ...photo, ...checkResult } : photo
                    )
                );
            });
    }, [photos]);

    const issuesById = useMemo(() => findPhotoIssues(photos), [photos]);

    const keptPhotos = photos.filter((photo) => !photo.isExcluded);
    const flaggedCount = photos.filter((photo) => issuesById[photo.id]?.length > 0).length;
    const pendingCount = photos.filter((photo) => photo.analysisStatus === 'pending').length;
    const selectedPhoto = photos.find((photo) => photo.id === selectedPhotoId) ?? null;
    const previewFilter = buildPreviewFilter(brightness, contrast);
    const isPreparing = preparedCount !== null;
    const hasAdjustments = brightness !== 0 || contrast !== 0;

    function openFilePicker() {
        playSound('click');
        fileInputRef.current?.click();
    }

    function addFiles(fileList) {
        const newPhotos = Array.from(fileList)
            .filter((file) => file.type.startsWith('image/'))
            .map((file) => ({
                id: `photo-${nextPhotoNumber++}`,
                file,
                url: URL.createObjectURL(file),
                analysisStatus: 'pending',
                analysis: null,
                isExcluded: false,
            }));

        if (newPhotos.length > 0) {
            setPhotos((currentPhotos) => [...currentPhotos, ...newPhotos]);
        }
    }

    function handleFileInputChange(event) {
        if (event.target.files) addFiles(event.target.files);
        // Clear so choosing the same files again still fires onChange.
        event.target.value = '';
    }

    function handleDragOver(event) {
        event.preventDefault();
        setIsDragging(true);
    }

    function handleDragLeave() {
        setIsDragging(false);
    }

    function handleDrop(event) {
        event.preventDefault();
        setIsDragging(false);
        if (event.dataTransfer.files) addFiles(event.dataTransfer.files);
    }

    function toggleExcluded(photoId) {
        playSound('click');
        setPhotos((currentPhotos) =>
            currentPhotos.map((photo) =>
                photo.id === photoId ? { ...photo, isExcluded: !photo.isExcluded } : photo
            )
        );
    }

    function removePhoto(photoId) {
        playSound('click');
        const photoToRemove = photos.find((photo) => photo.id === photoId);
        if (photoToRemove) URL.revokeObjectURL(photoToRemove.url);
        setPhotos((currentPhotos) => currentPhotos.filter((photo) => photo.id !== photoId));
        if (selectedPhotoId === photoId) setSelectedPhotoId(null);
    }

    // Phones toggle directly; desktop opens the large preview.
    function handleThumbnailClick(photoId) {
        if (isPhone) {
            toggleExcluded(photoId);
        } else {
            playSound('click');
            setSelectedPhotoId(photoId);
        }
    }

    function leaveOutFlagged() {
        playSound('click');
        setPhotos((currentPhotos) =>
            currentPhotos.map((photo) =>
                issuesById[photo.id]?.length > 0 ? { ...photo, isExcluded: true } : photo
            )
        );
    }

    function keepAll() {
        playSound('click');
        setPhotos((currentPhotos) => currentPhotos.map((photo) => ({ ...photo, isExcluded: false })));
    }

    function resetAdjustments() {
        playSound('click');
        setBrightness(0);
        setContrast(0);
    }

    async function handleGenerate() {
        playSound('click');
        setPreparedCount(0);
        try {
            const filesToUpload = [];
            for (const photo of keptPhotos) {
                filesToUpload.push(await applyAdjustments(photo.file, brightness, contrast));
                setPreparedCount(filesToUpload.length);
            }
            // On success App switches to the processing screen; on failure it
            // sets uploadError, which is shown in the bottom bar.
            await onGenerateModel(filesToUpload);
        } finally {
            setPreparedCount(null);
        }
    }

    function renderGenerateLabel() {
        if (!isPreparing) return 'Generate 3D model';
        if (preparedCount < keptPhotos.length) return `Preparing ${preparedCount}/${keptPhotos.length}...`;
        return 'Uploading...';
    }

    function renderFooterMessage() {
        if (uploadError) {
            return <span className="photo-editor-error" role="alert">{uploadError}</span>;
        }
        if (keptPhotos.length < MIN_PHOTOS) {
            return `Keep at least ${MIN_PHOTOS} photos to build a model (${keptPhotos.length} kept).`;
        }
        return `${keptPhotos.length} photos will be used.`;
    }

    function renderPreviewDetails(photo) {
        if (photo.analysisStatus === 'pending') {
            return <p className="photo-editor-preview-note">Checking this photo...</p>;
        }
        if (photo.analysisStatus === 'failed') {
            return (
                <p className="photo-editor-preview-note">
                    This photo couldn't be checked in this browser, but it can still be used.
                </p>
            );
        }

        const issues = issuesById[photo.id] ?? [];
        if (issues.length === 0) {
            return <p className="photo-editor-preview-note is-good">No problems found.</p>;
        }

        return (
            <ul className="photo-editor-issue-list">
                {issues.map((issue) => (
                    <li key={issue}>
                        <b>{ISSUE_LABELS[issue]}</b>
                        <span>{ISSUE_EXPLANATIONS[issue]}</span>
                    </li>
                ))}
            </ul>
        );
    }

    return (
        <div
            className="photo-editor"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="photo-editor-heading">
                <div>
                    <div className="eyebrow eyebrow-accent">Prepare photos</div>
                    <h1 className="photo-editor-title">Photo Editor</h1>
                    <p className="photo-editor-subtitle">
                        Check your photos before building a model. Blurry, duplicate and badly lit
                        photos are flagged so you can leave them out.
                    </p>
                </div>
                {photos.length > 0 && (
                    <button className="forma-btn" onClick={openFilePicker}>
                        <Icon name="plus" size={14} /> Add photos
                    </button>
                )}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={handleFileInputChange}
                />
            </div>

            {photos.length === 0 ? (
                <button
                    type="button"
                    className={isDragging ? 'photo-editor-empty is-dragging' : 'photo-editor-empty'}
                    onClick={openFilePicker}
                >
                    <Icon name="image" size={30} />
                    <span className="photo-editor-empty-title">Add photos to get started</span>
                    <span className="photo-editor-empty-hint">
                        {isPhone ? 'Tap to choose photos' : 'Drop photos here, or click to choose'}
                    </span>
                </button>
            ) : (
                <>
                    <div className="photo-editor-summary">
                        <div className="photo-editor-counts">
                            <span><b>{photos.length}</b> photos</span>
                            <span><b>{keptPhotos.length}</b> kept</span>
                            <span className={flaggedCount > 0 ? 'is-warning' : ''}>
                                <b>{flaggedCount}</b> flagged
                            </span>
                            {pendingCount > 0 && (
                                <span className="photo-editor-checking">
                                    Checking {photos.length - pendingCount}/{photos.length}...
                                </span>
                            )}
                        </div>
                        <div className="photo-editor-summary-actions">
                            <button className="forma-btn" onClick={leaveOutFlagged} disabled={flaggedCount === 0}>
                                <Icon name="wand" size={14} /> Leave out flagged
                            </button>
                            <button className="forma-btn" onClick={keepAll}>
                                <Icon name="refresh" size={14} /> Keep all
                            </button>
                        </div>
                    </div>

                    <div className={isDragging ? 'photo-editor-body is-dragging' : 'photo-editor-body'}>
                        <div className="photo-editor-grid">
                            {photos.map((photo) => {
                                const issues = issuesById[photo.id] ?? [];
                                const thumbClassName = [
                                    'photo-editor-thumb',
                                    photo.isExcluded ? 'is-excluded' : '',
                                    !isPhone && photo.id === selectedPhotoId ? 'is-selected' : '',
                                ].filter(Boolean).join(' ');

                                return (
                                    <div key={photo.id} className={thumbClassName}>
                                        <button
                                            type="button"
                                            className="photo-editor-thumb-image"
                                            onClick={() => handleThumbnailClick(photo.id)}
                                            aria-label={isPhone ? 'Keep or leave out this photo' : 'Preview this photo'}
                                        >
                                            <img src={photo.url} alt="" loading="lazy" style={{ filter: previewFilter }} />
                                            {photo.isExcluded && (
                                                <span className="photo-editor-excluded-label">Left out</span>
                                            )}
                                            {issues.length > 0 && (
                                                <span className="photo-editor-issue-badges">
                                                    {issues.map((issue) => (
                                                        <span key={issue} className="photo-editor-issue">
                                                            {ISSUE_LABELS[issue]}
                                                        </span>
                                                    ))}
                                                </span>
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            className={photo.isExcluded ? 'photo-editor-keep-toggle' : 'photo-editor-keep-toggle is-kept'}
                                            onClick={() => toggleExcluded(photo.id)}
                                            aria-label={photo.isExcluded ? 'Keep this photo' : 'Leave this photo out'}
                                        >
                                            <Icon name={photo.isExcluded ? 'plus' : 'check'} size={14} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <aside className="photo-editor-panel">
                            {!isPhone && (
                                <div className="forma-card photo-editor-preview">
                                    {selectedPhoto ? (
                                        <>
                                            <div className="photo-editor-preview-frame">
                                                <img
                                                    src={selectedPhoto.url}
                                                    alt="Selected photo"
                                                    style={{ filter: isShowingOriginal ? 'none' : previewFilter }}
                                                />
                                            </div>
                                            <div className="photo-editor-preview-name">{selectedPhoto.file.name}</div>
                                            {renderPreviewDetails(selectedPhoto)}
                                            <div className="photo-editor-preview-actions">
                                                {hasAdjustments && (
                                                    <button
                                                        className="forma-btn"
                                                        onPointerDown={() => setIsShowingOriginal(true)}
                                                        onPointerUp={() => setIsShowingOriginal(false)}
                                                        onPointerLeave={() => setIsShowingOriginal(false)}
                                                        onPointerCancel={() => setIsShowingOriginal(false)}
                                                    >
                                                        <Icon name="eye" size={14} /> Hold to see original
                                                    </button>
                                                )}
                                                <button className="forma-btn" onClick={() => toggleExcluded(selectedPhoto.id)}>
                                                    {selectedPhoto.isExcluded ? 'Keep photo' : 'Leave out'}
                                                </button>
                                                <button className="forma-btn" onClick={() => removePhoto(selectedPhoto.id)}>
                                                    Remove
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <p className="photo-editor-preview-note">
                                            Click a photo to see it larger and find out why it was flagged.
                                        </p>
                                    )}
                                </div>
                            )}

                            <div className="forma-card photo-editor-adjust">
                                <div className="eyebrow">Adjust all photos</div>

                                <label className="photo-editor-slider">
                                    <span>Brightness <b>{brightness > 0 ? `+${brightness}` : brightness}</b></span>
                                    <input
                                        type="range"
                                        min="-50"
                                        max="50"
                                        value={brightness}
                                        onChange={(event) => setBrightness(Number(event.target.value))}
                                    />
                                </label>

                                {!isPhone && (
                                    <label className="photo-editor-slider">
                                        <span>Contrast <b>{contrast > 0 ? `+${contrast}` : contrast}</b></span>
                                        <input
                                            type="range"
                                            min="-50"
                                            max="50"
                                            value={contrast}
                                            onChange={(event) => setContrast(Number(event.target.value))}
                                        />
                                    </label>
                                )}

                                <p className="photo-editor-hint">
                                    Changes apply to every photo equally, so they still line up for the
                                    3D model. Saving changes removes camera details that help
                                    reconstruction, so leave these at 0 unless your photos are clearly
                                    too dark or too bright.
                                </p>
                                {isPhone && (
                                    <p className="photo-editor-hint">More adjustments are available on a larger screen.</p>
                                )}

                                <button className="forma-btn" onClick={resetAdjustments} disabled={!hasAdjustments}>
                                    <Icon name="refresh" size={14} /> Reset
                                </button>
                            </div>
                        </aside>
                    </div>

                    <div className="photo-editor-footer">
                        <div className="photo-editor-footer-text">{renderFooterMessage()}</div>
                        <button
                            className="forma-btn forma-btn-primary"
                            onClick={handleGenerate}
                            disabled={keptPhotos.length < MIN_PHOTOS || isPreparing}
                        >
                            <Icon name="sparkle" size={14} /> {renderGenerateLabel()}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

export default PhotoEditorScreen;