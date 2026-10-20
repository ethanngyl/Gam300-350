/*!************************************************************************
\file PhotoEditorScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 20-10-2026
\brief
Photo Editor tab: checks and prepares photos before reconstruction.
Photos come from the device or the photo library. Each one is checked in
the browser for blur, bad exposure and near-duplicates, and can be kept
or left out. Edits (brightness, contrast, sharpen, crop) apply to all
photos by default; on desktop a photo can also be edited on its own, with
a warning when photos end up cropped differently. "Generate 3D model"
uploads only the kept photos through onGenerateModel (App's
handleBatchReady). Phones get a simpler, batch-only set of tools.
**************************************************************************/

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import LibraryPhotoPicker from './LibraryPhotoPicker.jsx';
import { playSound } from '../audio/Audio.js';
import {
    analyzePhoto,
    buildPreviewFilter,
    findPhotoIssues,
    ISSUE_EXPLANATIONS,
    ISSUE_LABELS,
} from './photoChecks.js';
import {
    cropsMatch,
    DEFAULT_EDITS,
    exportEditedFile,
    hasCrop,
    hasEdits,
    MAX_CROP_INSET,
    NO_CROP,
    renderEditedCanvas,
} from './photoEdits.js';
import './PhotoEditor.css';

// Fewest kept photos allowed before building a model (matches capture).
const MIN_PHOTOS = 8;
// Same breakpoint as the phone layout in AppTheme.css.
const PHONE_MEDIA_QUERY = '(max-width: 760px)';
// Longest side of the large preview, in pixels.
const PREVIEW_LONGEST_SIDE = 900;
// Wait this long after the last slider change before redrawing the preview.
const PREVIEW_DELAY_MS = 150;
// The phone "Trim edges" slider cuts up to this percentage from each side.
const MAX_TRIM_PERCENT = 30;

const CROP_EDGES = ['top', 'right', 'bottom', 'left'];

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

function formatSigned(value) {
    return value > 0 ? `+${value}` : `${value}`;
}

// Box drawn over the preview; dragging an edge handle moves that side of
// the crop. Each side is limited to MAX_CROP_INSET.
function CropOverlay({ crop, onChange }) {
    const overlayRef = useRef(null);

    function handlePointerDown(edge, event) {
        const overlay = overlayRef.current;
        if (!overlay) return;
        event.preventDefault();

        const overlayBounds = overlay.getBoundingClientRect();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);

        function handlePointerMove(moveEvent) {
            const fractionFromLeft = (moveEvent.clientX - overlayBounds.left) / overlayBounds.width;
            const fractionFromTop = (moveEvent.clientY - overlayBounds.top) / overlayBounds.height;
            const insetByEdge = {
                left: fractionFromLeft,
                right: 1 - fractionFromLeft,
                top: fractionFromTop,
                bottom: 1 - fractionFromTop,
            };
            const nextInset = Math.min(MAX_CROP_INSET, Math.max(0, insetByEdge[edge]));
            onChange({ ...crop, [edge]: nextInset });
        }

        function handlePointerUp() {
            handle.removeEventListener('pointermove', handlePointerMove);
            handle.removeEventListener('pointerup', handlePointerUp);
            handle.removeEventListener('pointercancel', handlePointerUp);
        }

        handle.addEventListener('pointermove', handlePointerMove);
        handle.addEventListener('pointerup', handlePointerUp);
        handle.addEventListener('pointercancel', handlePointerUp);
    }

    return (
        <div className="photo-editor-crop-overlay" ref={overlayRef}>
            <div
                className="photo-editor-crop-box"
                style={{
                    top: `${crop.top * 100}%`,
                    right: `${crop.right * 100}%`,
                    bottom: `${crop.bottom * 100}%`,
                    left: `${crop.left * 100}%`,
                }}
            >
                {CROP_EDGES.map((edge) => (
                    <span
                        key={edge}
                        className={`photo-editor-crop-handle is-${edge}`}
                        onPointerDown={(event) => handlePointerDown(edge, event)}
                    />
                ))}
            </div>
        </div>
    );
}

function PhotoEditorScreen({ onGenerateModel, uploadError }) {
    const isPhone = useIsPhone();
    const fileInputRef = useRef(null);
    const previewCanvasRef = useRef(null);
    // Id of the photo currently being checked, so only one runs at a time.
    const analyzingPhotoIdRef = useRef(null);
    // Latest photo list, read when the screen closes to release preview URLs.
    const photosRef = useRef([]);

    const [photos, setPhotos] = useState([]);
    const [selectedPhotoId, setSelectedPhotoId] = useState(null);
    // Edits shared by every photo that hasn't been edited on its own.
    const [batchEdits, setBatchEdits] = useState(DEFAULT_EDITS);
    // 'all' edits batchEdits; 'photo' edits only the selected photo (desktop).
    const [editTarget, setEditTarget] = useState('all');
    const [isCropping, setIsCropping] = useState(false);
    const [isShowingOriginal, setIsShowingOriginal] = useState(false);
    const [previewFailed, setPreviewFailed] = useState(false);
    const [isLibraryPickerOpen, setIsLibraryPickerOpen] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    // How many photos have been prepared for upload; null when not uploading.
    const [preparedCount, setPreparedCount] = useState(null);

    useEffect(() => {
        photosRef.current = photos;
    }, [photos]);

    // Release every thumbnail URL when the editor closes.
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
    const separatelyEditedCount = photos.filter((photo) => photo.customEdits).length;
    const selectedPhoto = photos.find((photo) => photo.id === selectedPhotoId) ?? null;
    const isPreparing = preparedCount !== null;

    const isEditingSinglePhoto = !isPhone && editTarget === 'photo' && selectedPhoto !== null;
    const isCropToolActive = !isPhone && isCropping && selectedPhoto !== null;

    // A photo uses its own edits if it has any, otherwise the shared ones.
    function editsFor(photo) {
        return photo.customEdits ?? batchEdits;
    }

    const currentEdits = isEditingSinglePhoto ? editsFor(selectedPhoto) : batchEdits;

    const firstKeptCrop = keptPhotos.length > 0 ? editsFor(keptPhotos[0]).crop : NO_CROP;
    const hasMixedCrops = keptPhotos.some((photo) => !cropsMatch(editsFor(photo).crop, firstKeptCrop));

    // What the large preview shows: the original, the photo uncropped with a
    // crop box over it while cropping, or the finished result.
    let previewEdits = null;
    if (selectedPhoto) {
        if (isShowingOriginal) {
            previewEdits = DEFAULT_EDITS;
        } else if (isCropToolActive) {
            previewEdits = { ...editsFor(selectedPhoto), crop: NO_CROP };
        } else {
            previewEdits = editsFor(selectedPhoto);
        }
    }
    const previewEditsKey = previewEdits ? JSON.stringify(previewEdits) : '';
    const selectedFile = selectedPhoto?.file ?? null;

    // Redraw the large preview with the same processing used for upload,
    // shortly after the last change so dragging a slider stays smooth.
    useEffect(() => {
        if (!selectedFile || isPhone) return;

        let isCancelled = false;
        const timerId = setTimeout(async () => {
            try {
                const renderedCanvas = await renderEditedCanvas(
                    selectedFile,
                    JSON.parse(previewEditsKey),
                    PREVIEW_LONGEST_SIDE
                );
                const previewCanvas = previewCanvasRef.current;
                if (isCancelled || !previewCanvas) return;
                previewCanvas.width = renderedCanvas.width;
                previewCanvas.height = renderedCanvas.height;
                previewCanvas.getContext('2d').drawImage(renderedCanvas, 0, 0);
                setPreviewFailed(false);
            } catch {
                if (!isCancelled) setPreviewFailed(true);
            }
        }, PREVIEW_DELAY_MS);

        return () => {
            isCancelled = true;
            clearTimeout(timerId);
        };
    }, [selectedFile, previewEditsKey, isPhone]);

    function openFilePicker() {
        playSound('click');
        fileInputRef.current?.click();
    }

    function openLibraryPicker() {
        playSound('click');
        setIsLibraryPickerOpen(true);
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
                customEdits: null,
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
        if (selectedPhotoId === photoId) {
            setSelectedPhotoId(null);
            setIsCropping(false);
        }
    }

    // Phones toggle directly; desktop opens the large preview.
    function handleThumbnailClick(photoId) {
        if (isPhone) {
            toggleExcluded(photoId);
            return;
        }
        playSound('click');
        setPreviewFailed(false);
        setSelectedPhotoId(photoId);
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

    // Applies a change to whichever edits are being worked on.
    function updateEdits(changes) {
        if (isEditingSinglePhoto) {
            const editedPhotoId = selectedPhoto.id;
            setPhotos((currentPhotos) =>
                currentPhotos.map((photo) =>
                    photo.id === editedPhotoId
                        ? { ...photo, customEdits: { ...(photo.customEdits ?? batchEdits), ...changes } }
                        : photo
                )
            );
        } else {
            setBatchEdits((currentEdits) => ({ ...currentEdits, ...changes }));
        }
    }

    function changeEditTarget(target) {
        playSound('click');
        setEditTarget(target);
    }

    function resetCurrentEdits() {
        playSound('click');
        if (isEditingSinglePhoto) {
            updateEdits({ ...DEFAULT_EDITS });
        } else {
            setBatchEdits(DEFAULT_EDITS);
        }
    }

    // Drops the selected photo's own edits so it follows the shared ones again.
    function matchAllPhotos() {
        playSound('click');
        const matchedPhotoId = selectedPhoto.id;
        setPhotos((currentPhotos) =>
            currentPhotos.map((photo) =>
                photo.id === matchedPhotoId ? { ...photo, customEdits: null } : photo
            )
        );
    }

    function toggleCropTool() {
        playSound('click');
        setIsCropping((wasCropping) => !wasCropping);
    }

    function resetCrop() {
        playSound('click');
        updateEdits({ crop: NO_CROP });
    }

    // Phone "Trim edges": the same amount cut from every side of every photo.
    function handleTrimChange(trimPercent) {
        const trimFraction = trimPercent / 100;
        setBatchEdits((currentEdits) => ({
            ...currentEdits,
            crop: { left: trimFraction, top: trimFraction, right: trimFraction, bottom: trimFraction },
        }));
    }

    async function handleGenerate() {
        playSound('click');
        setIsCropping(false);
        setPreparedCount(0);
        try {
            const filesToUpload = [];
            for (const photo of keptPhotos) {
                filesToUpload.push(await exportEditedFile(photo.file, editsFor(photo)));
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

    const libraryPicker = isLibraryPickerOpen && (
        <LibraryPhotoPicker
            onAddFiles={addFiles}
            onClose={() => setIsLibraryPickerOpen(false)}
        />
    );

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
                    <div className="photo-editor-heading-actions">
                        <button className="forma-btn" onClick={openLibraryPicker}>
                            <Icon name="layers" size={14} /> From library
                        </button>
                        <button className="forma-btn" onClick={openFilePicker}>
                            <Icon name="plus" size={14} /> Add photos
                        </button>
                    </div>
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
                <div className="photo-editor-start">
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
                    <button className="forma-btn photo-editor-start-library" onClick={openLibraryPicker}>
                        <Icon name="layers" size={14} /> Or choose from your library
                    </button>
                </div>
            ) : (
                <>
                    <div className="photo-editor-summary">
                        <div className="photo-editor-counts">
                            <span><b>{photos.length}</b> photos</span>
                            <span><b>{keptPhotos.length}</b> kept</span>
                            <span className={flaggedCount > 0 ? 'is-warning' : ''}>
                                <b>{flaggedCount}</b> flagged
                            </span>
                            {separatelyEditedCount > 0 && (
                                <span><b>{separatelyEditedCount}</b> edited on their own</span>
                            )}
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
                                const photoEdits = editsFor(photo);
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
                                            <img
                                                src={photo.url}
                                                alt=""
                                                loading="lazy"
                                                style={{ filter: buildPreviewFilter(photoEdits.brightness, photoEdits.contrast) }}
                                            />
                                            {photo.customEdits && (
                                                <span className="photo-editor-edited-badge">Edited</span>
                                            )}
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
                                                {previewFailed ? (
                                                    <p className="photo-editor-preview-note">
                                                        This photo can't be previewed in this browser, but it can still be used.
                                                    </p>
                                                ) : (
                                                    <div className="photo-editor-canvas-wrap">
                                                        <canvas ref={previewCanvasRef} className="photo-editor-preview-canvas" />
                                                        {isCropToolActive && (
                                                            <CropOverlay
                                                                crop={currentEdits.crop}
                                                                onChange={(crop) => updateEdits({ crop })}
                                                            />
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {isCropToolActive && (
                                                <p className="photo-editor-hint">
                                                    Drag the edges to crop {isEditingSinglePhoto ? 'this photo only' : 'every photo the same way'}.
                                                </p>
                                            )}

                                            <div className="photo-editor-preview-name">{selectedPhoto.file.name}</div>
                                            {renderPreviewDetails(selectedPhoto)}

                                            <div className="photo-editor-preview-actions">
                                                <button
                                                    className={isCropToolActive ? 'forma-btn forma-btn-primary' : 'forma-btn'}
                                                    onClick={toggleCropTool}
                                                >
                                                    <Icon name="crop" size={14} /> {isCropToolActive ? 'Done cropping' : 'Crop'}
                                                </button>
                                                {isCropToolActive && hasCrop(currentEdits.crop) && (
                                                    <button className="forma-btn" onClick={resetCrop}>
                                                        Reset crop
                                                    </button>
                                                )}
                                                {!isCropToolActive && hasEdits(editsFor(selectedPhoto)) && (
                                                    <button
                                                        className="forma-btn photo-editor-hold-button"
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
                                            Click a photo to see it larger, crop it, or find out why it was flagged.
                                        </p>
                                    )}
                                </div>
                            )}

                            <div className="forma-card photo-editor-adjust">
                                {!isPhone && selectedPhoto ? (
                                    <div className="photo-editor-target">
                                        <button
                                            className={isEditingSinglePhoto ? '' : 'is-active'}
                                            onClick={() => changeEditTarget('all')}
                                        >
                                            All photos
                                        </button>
                                        <button
                                            className={isEditingSinglePhoto ? 'is-active' : ''}
                                            onClick={() => changeEditTarget('photo')}
                                        >
                                            This photo
                                        </button>
                                    </div>
                                ) : (
                                    <div className="eyebrow">Adjust all photos</div>
                                )}

                                <label className="photo-editor-slider">
                                    <span>Brightness <b>{formatSigned(currentEdits.brightness)}</b></span>
                                    <input
                                        type="range"
                                        min="-50"
                                        max="50"
                                        value={currentEdits.brightness}
                                        onChange={(event) => updateEdits({ brightness: Number(event.target.value) })}
                                    />
                                </label>

                                {!isPhone && (
                                    <label className="photo-editor-slider">
                                        <span>Contrast <b>{formatSigned(currentEdits.contrast)}</b></span>
                                        <input
                                            type="range"
                                            min="-50"
                                            max="50"
                                            value={currentEdits.contrast}
                                            onChange={(event) => updateEdits({ contrast: Number(event.target.value) })}
                                        />
                                    </label>
                                )}

                                <label className="photo-editor-slider">
                                    <span>Sharpen <b>{currentEdits.sharpen}</b></span>
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={currentEdits.sharpen}
                                        onChange={(event) => updateEdits({ sharpen: Number(event.target.value) })}
                                    />
                                </label>

                                {isPhone && (
                                    <label className="photo-editor-slider">
                                        <span>Trim edges <b>{Math.round(batchEdits.crop.left * 100)}%</b></span>
                                        <input
                                            type="range"
                                            min="0"
                                            max={MAX_TRIM_PERCENT}
                                            value={Math.round(batchEdits.crop.left * 100)}
                                            onChange={(event) => handleTrimChange(Number(event.target.value))}
                                        />
                                    </label>
                                )}

                                {hasMixedCrops && (
                                    <p className="photo-editor-warning">
                                        Some photos are cropped differently from the others. This can lower the
                                        quality of the 3D model, so keep crops the same where you can.
                                    </p>
                                )}

                                {isEditingSinglePhoto ? (
                                    <p className="photo-editor-hint">
                                        These edits apply to this photo only. For the best 3D result, keep your
                                        photos looking consistent with each other.
                                    </p>
                                ) : (
                                    <p className="photo-editor-hint">
                                        Changes apply to every photo equally, so they still line up for the 3D
                                        model. Edited photos lose camera details that help reconstruction, so
                                        only change what you need to.
                                    </p>
                                )}
                                {!isPhone && !selectedPhoto && (
                                    <p className="photo-editor-hint">Select a photo to crop it or to edit it on its own.</p>
                                )}
                                {isPhone && (
                                    <p className="photo-editor-hint">
                                        Editing single photos and cropping by hand are available on a larger screen.
                                    </p>
                                )}

                                <div className="photo-editor-adjust-actions">
                                    <button className="forma-btn" onClick={resetCurrentEdits} disabled={!hasEdits(currentEdits)}>
                                        <Icon name="refresh" size={14} /> Reset
                                    </button>
                                    {isEditingSinglePhoto && selectedPhoto.customEdits && (
                                        <button className="forma-btn" onClick={matchAllPhotos}>
                                            Match all photos
                                        </button>
                                    )}
                                </div>
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

            {libraryPicker}
        </div>
    );
}

export default PhotoEditorScreen;