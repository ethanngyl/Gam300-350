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
or left out. Edits (auto fix, brightness, contrast, warmth, tint, auto
color, pick a neutral spot, sharpen, crop) apply to all photos by
default; on desktop a photo can also be edited on its own. Strong
settings, lost highlight/shadow detail, large crops and mixed crops all
show warnings. "Use original photos" bypasses every edit. Edits are only
settings until upload, so the originals are never changed. Phones get a
simpler, batch-only set of tools. "Review photos first" in Camera Capture
opens the editor with that batch already loaded (initialPhotos).
**************************************************************************/

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import LibraryPhotoPicker from './LibraryPhotoPicker.jsx';
import { playSound } from '../audio/Audio.js';
import {
    analyzePhoto,
    findPhotoIssues,
    ISSUE_EXPLANATIONS,
    ISSUE_LABELS,
} from './PhotoChecks.js';
import {
    buildChannelTransfer,
    computeAutoFix,
    computeWhiteBalance,
    cropsMatch,
    DEFAULT_EDITS,
    exportEditedFile,
    hasColorChange,
    hasCrop,
    hasEdits,
    MAX_CROP_INSET,
    measureClippedShare,
    NO_CROP,
    renderEditedCanvas,
    sampleColor,
} from './PhotoEdits.js';
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
// SVG filter shared by every photo that uses the batch edits.
const BATCH_FILTER_ID = 'photo-editor-filter-batch';

// Past these values a slider turns coral and shows its warning.
const STRONG_SETTING_LIMITS = {
    brightness: 30,
    contrast: 30,
    warmth: 35,
    tint: 35,
    sharpen: 60,
};

const STRONG_SETTING_WARNINGS = {
    brightness: 'Strong brightness changes can wash out or hide detail.',
    contrast: 'Strong contrast can lose detail in the brightest and darkest areas.',
    warmth: 'A strong color shift can make the model look unnatural.',
    tint: 'A strong color shift can make the model look unnatural.',
    sharpen: 'Strong sharpening can add halos that confuse the 3D matching.',
};

// A crop cutting more than this from any side shows a reminder.
const LARGE_CROP_INSET = 0.25;
// Warn when an edit turns this much more of the photo pure white or black.
const CLIPPING_INCREASE_WARNING = 0.03;

const CROP_EDGES = ['top', 'right', 'bottom', 'left'];

let nextPhotoNumber = 0;

// One entry in the editor's photo list. Checks start as 'pending'.
function createEditorPhoto(file) {
    return {
        id: `photo-${nextPhotoNumber++}`,
        file,
        url: URL.createObjectURL(file),
        analysisStatus: 'pending',
        analysis: null,
        isExcluded: false,
        customEdits: null,
    };
}

function isImageFile(file) {
    return file.type.startsWith('image/');
}

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

function filterIdForPhoto(photoId) {
    return `photo-editor-filter-${photoId}`;
}

// SVG filter applying the colour edits to a thumbnail. Uses the same
// formula as the upload, so the grid shows what will actually be sent.
function ColorFilter({ filterId, edits }) {
    const transfer = buildChannelTransfer(edits);
    return (
        <filter id={filterId} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
                <feFuncR type="linear" slope={transfer.red.slope} intercept={transfer.red.intercept} />
                <feFuncG type="linear" slope={transfer.green.slope} intercept={transfer.green.intercept} />
                <feFuncB type="linear" slope={transfer.blue.slope} intercept={transfer.blue.intercept} />
            </feComponentTransfer>
        </filter>
    );
}

// One slider, which turns coral and explains the risk past its strong limit.
function EditSlider({ label, settingName, value, min, max, onChange, isSigned = true }) {
    const isStrong = Math.abs(value) > STRONG_SETTING_LIMITS[settingName];

    return (
        <label className={isStrong ? 'photo-editor-slider is-strong' : 'photo-editor-slider'}>
            <span>{label} <b>{isSigned ? formatSigned(value) : value}</b></span>
            <input
                type="range"
                min={min}
                max={max}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
            />
            {isStrong && (
                <small className="photo-editor-slider-warning">{STRONG_SETTING_WARNINGS[settingName]}</small>
            )}
        </label>
    );
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

// initialPhotos: { files, removeBackground } handed over from Camera Capture,
// or null when the editor is opened on its own.
function PhotoEditorScreen({ onGenerateModel, uploadError, initialPhotos = null }) {
    const isPhone = useIsPhone();
    const fileInputRef = useRef(null);
    const previewCanvasRef = useRef(null);
    // Id of the photo currently being checked, so only one runs at a time.
    const analyzingPhotoIdRef = useRef(null);
    // Latest photo list, read when the screen closes to release preview URLs.
    const photosRef = useRef([]);

    const [photos, setPhotos] = useState(() =>
        (initialPhotos?.files ?? []).filter(isImageFile).map(createEditorPhoto)
    );
    // Carried over from Camera Capture so the build uses the same setting.
    const removeBackground = initialPhotos?.removeBackground ?? false;
    const [selectedPhotoId, setSelectedPhotoId] = useState(null);
    // Edits shared by every photo that hasn't been edited on its own.
    const [batchEdits, setBatchEdits] = useState(DEFAULT_EDITS);
    // 'all' edits batchEdits; 'photo' edits only the selected photo (desktop).
    const [editTarget, setEditTarget] = useState('all');
    // When true, every edit is bypassed and the original files are uploaded.
    const [useOriginals, setUseOriginals] = useState(false);
    const [isCropping, setIsCropping] = useState(false);
    const [isPickingNeutral, setIsPickingNeutral] = useState(false);
    // Message from auto colour or the neutral-spot picker, if one failed.
    const [colorMessage, setColorMessage] = useState(null);
    const [isShowingOriginal, setIsShowingOriginal] = useState(false);
    const [previewFailed, setPreviewFailed] = useState(false);
    // Share of the preview that is pure white or black after edits.
    const [previewClippedShare, setPreviewClippedShare] = useState(null);
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
    const isCropToolActive = !isPhone && !useOriginals && isCropping && selectedPhoto !== null;
    const isPickToolActive = !isPhone && !useOriginals && isPickingNeutral && selectedPhoto !== null && !isCropToolActive;

    // A photo uses its own edits if it has any, otherwise the shared ones.
    function editsFor(photo) {
        return photo.customEdits ?? batchEdits;
    }

    const currentEdits = isEditingSinglePhoto ? editsFor(selectedPhoto) : batchEdits;

    const firstKeptCrop = keptPhotos.length > 0 ? editsFor(keptPhotos[0]).crop : NO_CROP;
    const hasMixedCrops = !useOriginals && keptPhotos.some((photo) => !cropsMatch(editsFor(photo).crop, firstKeptCrop));
    const hasLargeCrop = Object.values(currentEdits.crop).some((inset) => inset > LARGE_CROP_INSET);

    // Measurements the auto tools work from: just the selected photo when
    // editing it on its own, otherwise every kept photo that's been checked.
    const autoSourceAnalyses = isEditingSinglePhoto
        ? (selectedPhoto.analysisStatus === 'done' ? [selectedPhoto.analysis] : [])
        : keptPhotos.filter((photo) => photo.analysisStatus === 'done').map((photo) => photo.analysis);

    // What the large preview shows: the original, the photo uncropped with a
    // crop box over it while cropping, or the finished result.
    let previewEdits = null;
    if (selectedPhoto) {
        if (isShowingOriginal || useOriginals) {
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

                const renderedPixelBytes = renderedCanvas
                    .getContext('2d')
                    .getImageData(0, 0, renderedCanvas.width, renderedCanvas.height).data;
                setPreviewClippedShare(measureClippedShare(renderedPixelBytes));
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

    // How much more of the selected photo is pure white or black than in the
    // original, if enough to warn about. Comparing with the original means a
    // photo that was already on a white background doesn't trigger it.
    let addedClippedShare = 0;
    if (
        selectedPhoto &&
        selectedPhoto.analysisStatus === 'done' &&
        previewClippedShare !== null &&
        !isShowingOriginal &&
        !useOriginals &&
        hasColorChange(editsFor(selectedPhoto))
    ) {
        addedClippedShare = previewClippedShare - selectedPhoto.analysis.clippedShare;
    }

    function filterForPhoto(photo) {
        if (useOriginals) return 'none';
        const photoEdits = editsFor(photo);
        if (!hasColorChange(photoEdits)) return 'none';
        return `url(#${photo.customEdits ? filterIdForPhoto(photo.id) : BATCH_FILTER_ID})`;
    }

    function openFilePicker() {
        playSound('tap');
        fileInputRef.current?.click();
    }

    function openLibraryPicker() {
        playSound('tap');
        setIsLibraryPickerOpen(true);
    }

    function addFiles(fileList) {
        const newPhotos = Array.from(fileList).filter(isImageFile).map(createEditorPhoto);

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
        playSound('tap');
        setPhotos((currentPhotos) =>
            currentPhotos.map((photo) =>
                photo.id === photoId ? { ...photo, isExcluded: !photo.isExcluded } : photo
            )
        );
    }

    function removePhoto(photoId) {
        playSound('tap');
        const photoToRemove = photos.find((photo) => photo.id === photoId);
        if (photoToRemove) URL.revokeObjectURL(photoToRemove.url);
        setPhotos((currentPhotos) => currentPhotos.filter((photo) => photo.id !== photoId));
        if (selectedPhotoId === photoId) {
            setSelectedPhotoId(null);
            setIsCropping(false);
            setIsPickingNeutral(false);
        }
    }

    // Phones toggle directly; desktop opens the large preview.
    function handleThumbnailClick(photoId) {
        if (isPhone) {
            toggleExcluded(photoId);
            return;
        }
        playSound('tap');
        setPreviewFailed(false);
        setPreviewClippedShare(null);
        setColorMessage(null);
        setSelectedPhotoId(photoId);
    }

    function leaveOutFlagged() {
        playSound('tap');
        setPhotos((currentPhotos) =>
            currentPhotos.map((photo) =>
                issuesById[photo.id]?.length > 0 ? { ...photo, isExcluded: true } : photo
            )
        );
    }

    function keepAll() {
        playSound('tap');
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
            setBatchEdits((currentEditValues) => ({ ...currentEditValues, ...changes }));
        }
    }

    function changeEditTarget(target) {
        playSound('tap');
        setEditTarget(target);
        setColorMessage(null);
    }

    function resetCurrentEdits() {
        playSound('tap');
        setColorMessage(null);
        if (isEditingSinglePhoto) {
            updateEdits({ ...DEFAULT_EDITS });
        } else {
            setBatchEdits(DEFAULT_EDITS);
        }
    }

    // Drops the selected photo's own edits so it follows the shared ones again.
    function matchAllPhotos() {
        playSound('tap');
        const matchedPhotoId = selectedPhoto.id;
        setPhotos((currentPhotos) =>
            currentPhotos.map((photo) =>
                photo.id === matchedPhotoId ? { ...photo, customEdits: null } : photo
            )
        );
    }

    function handleAutoFix() {
        playSound('tap');
        const correction = computeAutoFix(autoSourceAnalyses);
        if (correction) updateEdits(correction);
    }

    // Gray world: the average colour across the photos should be neutral.
    function handleAutoColor() {
        playSound('tap');
        const sourceCount = autoSourceAnalyses.length;
        if (sourceCount === 0) return;

        const averageRed = autoSourceAnalyses.reduce((total, analysis) => total + analysis.averageRed, 0) / sourceCount;
        const averageGreen = autoSourceAnalyses.reduce((total, analysis) => total + analysis.averageGreen, 0) / sourceCount;
        const averageBlue = autoSourceAnalyses.reduce((total, analysis) => total + analysis.averageBlue, 0) / sourceCount;

        const correction = computeWhiteBalance(averageRed, averageGreen, averageBlue);
        if (correction) {
            updateEdits(correction);
            setColorMessage(null);
        } else {
            setColorMessage("Auto colour couldn't find a reliable color to balance against. Try the warmth slider instead.");
        }
    }

    function togglePickNeutral() {
        playSound('tap');
        setColorMessage(null);
        setIsPickingNeutral((wasPicking) => !wasPicking);
    }

    // Reads the clicked spot from the unedited photo and sets warmth and
    // tint so that spot becomes neutral grey.
    async function handlePreviewClick(event) {
        if (!isPickToolActive) return;

        const canvasBounds = event.currentTarget.getBoundingClientRect();
        const fractionX = (event.clientX - canvasBounds.left) / canvasBounds.width;
        const fractionY = (event.clientY - canvasBounds.top) / canvasBounds.height;
        const displayedCrop = editsFor(selectedPhoto).crop;

        setIsPickingNeutral(false);
        try {
            const sampledColor = await sampleColor(selectedPhoto.file, displayedCrop, fractionX, fractionY);
            const correction = computeWhiteBalance(sampledColor.red, sampledColor.green, sampledColor.blue);
            if (correction) {
                playSound('tap');
                updateEdits(correction);
                setColorMessage(null);
            } else {
                setColorMessage('That spot is too dark or too close to pure white. Pick a light grey or off-white area.');
            }
        } catch {
            setColorMessage("Couldn't read that spot. Try another one.");
        }
    }

    function toggleCropTool() {
        playSound('tap');
        setIsPickingNeutral(false);
        setIsCropping((wasCropping) => !wasCropping);
    }

    function resetCrop() {
        playSound('tap');
        updateEdits({ crop: NO_CROP });
    }

    // Phone "Trim edges": the same amount cut from every side of every photo.
    function handleTrimChange(trimPercent) {
        const trimFraction = trimPercent / 100;
        setBatchEdits((currentEditValues) => ({
            ...currentEditValues,
            crop: { left: trimFraction, top: trimFraction, right: trimFraction, bottom: trimFraction },
        }));
    }

    function handleUseOriginalsChange(event) {
        playSound('tap');
        setUseOriginals(event.target.checked);
        setIsCropping(false);
        setIsPickingNeutral(false);
    }

    async function handleGenerate() {
        playSound('tap');
        setIsCropping(false);
        setIsPickingNeutral(false);
        setPreparedCount(0);
        try {
            const filesToUpload = [];
            for (const photo of keptPhotos) {
                filesToUpload.push(useOriginals ? photo.file : await exportEditedFile(photo.file, editsFor(photo)));
                setPreparedCount(filesToUpload.length);
            }
            // On success App switches to the processing screen; on failure it
            // sets uploadError, which is shown in the bottom bar.
            await onGenerateModel(filesToUpload, { removeBackground });
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
        if (useOriginals) {
            return `${keptPhotos.length} original photos will be used, without edits.`;
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
            {/* Color filters used by the thumbnails. */}
            <svg className="photo-editor-filter-defs" aria-hidden="true" focusable="false">
                <defs>
                    <ColorFilter filterId={BATCH_FILTER_ID} edits={batchEdits} />
                    {photos
                        .filter((photo) => photo.customEdits)
                        .map((photo) => (
                            <ColorFilter key={photo.id} filterId={filterIdForPhoto(photo.id)} edits={photo.customEdits} />
                        ))}
                </defs>
            </svg>

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
                                                style={{ filter: filterForPhoto(photo) }}
                                            />
                                            {photo.customEdits && !useOriginals && (
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
                                                        <canvas
                                                            ref={previewCanvasRef}
                                                            className={isPickToolActive ? 'photo-editor-preview-canvas is-picking' : 'photo-editor-preview-canvas'}
                                                            onClick={handlePreviewClick}
                                                        />
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
                                            {isPickToolActive && (
                                                <p className="photo-editor-hint">
                                                    Click something in the photo that should be grey or white, like the turntable or a white card.
                                                </p>
                                            )}
                                            {addedClippedShare > CLIPPING_INCREASE_WARNING && (
                                                <p className="photo-editor-warning">
                                                    These edits turn about {Math.round(addedClippedShare * 100)}% more of this
                                                    photo pure white or black, so some detail is lost. Try a gentler setting.
                                                </p>
                                            )}

                                            <div className="photo-editor-preview-name">{selectedPhoto.file.name}</div>
                                            {renderPreviewDetails(selectedPhoto)}

                                            <div className="photo-editor-preview-actions">
                                                <button
                                                    className={isCropToolActive ? 'forma-btn forma-btn-primary' : 'forma-btn'}
                                                    onClick={toggleCropTool}
                                                    disabled={useOriginals}
                                                >
                                                    <Icon name="crop" size={14} /> {isCropToolActive ? 'Done cropping' : 'Crop'}
                                                </button>
                                                {isCropToolActive && hasCrop(currentEdits.crop) && (
                                                    <button className="forma-btn" onClick={resetCrop}>
                                                        Reset crop
                                                    </button>
                                                )}
                                                {!isCropToolActive && !useOriginals && hasEdits(editsFor(selectedPhoto)) && (
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
                                            disabled={useOriginals}
                                        >
                                            All photos
                                        </button>
                                        <button
                                            className={isEditingSinglePhoto ? 'is-active' : ''}
                                            onClick={() => changeEditTarget('photo')}
                                            disabled={useOriginals}
                                        >
                                            This photo
                                        </button>
                                    </div>
                                ) : (
                                    <div className="eyebrow">Adjust all photos</div>
                                )}

                                {useOriginals && (
                                    <p className="photo-editor-hint">
                                        Edits are switched off. Turn off "Use original photos" to apply them again.
                                    </p>
                                )}

                                {/* Disabling the fieldset disables every control inside it. */}
                                <fieldset className="photo-editor-adjust-fields" disabled={useOriginals}>
                                    <div className="photo-editor-auto-actions">
                                        <button
                                            type="button"
                                            className="forma-btn"
                                            onClick={handleAutoFix}
                                            disabled={autoSourceAnalyses.length === 0}
                                        >
                                            <Icon name="wand" size={14} /> Auto fix
                                        </button>
                                        <button
                                            type="button"
                                            className="forma-btn"
                                            onClick={handleAutoColor}
                                            disabled={autoSourceAnalyses.length === 0}
                                        >
                                            <Icon name="sun" size={14} /> Auto colour
                                        </button>
                                        {!isPhone && (
                                            <button
                                                type="button"
                                                className={isPickToolActive ? 'forma-btn forma-btn-primary' : 'forma-btn'}
                                                onClick={togglePickNeutral}
                                                disabled={!selectedPhoto || isCropToolActive}
                                            >
                                                <Icon name="target" size={14} /> {isPickToolActive ? 'Cancel picking' : 'Pick neutral spot'}
                                            </button>
                                        )}
                                    </div>

                                    {colorMessage && <p className="photo-editor-warning">{colorMessage}</p>}

                                    <EditSlider
                                        label="Brightness"
                                        settingName="brightness"
                                        value={currentEdits.brightness}
                                        min={-50}
                                        max={50}
                                        onChange={(value) => updateEdits({ brightness: value })}
                                    />
                                    {!isPhone && (
                                        <EditSlider
                                            label="Contrast"
                                            settingName="contrast"
                                            value={currentEdits.contrast}
                                            min={-50}
                                            max={50}
                                            onChange={(value) => updateEdits({ contrast: value })}
                                        />
                                    )}
                                    <EditSlider
                                        label="Warmth"
                                        settingName="warmth"
                                        value={currentEdits.warmth}
                                        min={-50}
                                        max={50}
                                        onChange={(value) => updateEdits({ warmth: value })}
                                    />
                                    {!isPhone && (
                                        <EditSlider
                                            label="Tint"
                                            settingName="tint"
                                            value={currentEdits.tint}
                                            min={-50}
                                            max={50}
                                            onChange={(value) => updateEdits({ tint: value })}
                                        />
                                    )}
                                    <EditSlider
                                        label="Sharpen"
                                        settingName="sharpen"
                                        value={currentEdits.sharpen}
                                        min={0}
                                        max={100}
                                        isSigned={false}
                                        onChange={(value) => updateEdits({ sharpen: value })}
                                    />

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

                                    {hasLargeCrop && (
                                        <p className="photo-editor-warning">
                                            Large crop: check the object stays fully inside it in every photo, not just this one.
                                        </p>
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
                                        <p className="photo-editor-hint">
                                            Select a photo to crop it, pick a neutral spot, or edit it on its own.
                                        </p>
                                    )}
                                    {isPhone && (
                                        <p className="photo-editor-hint">
                                            Cropping by hand, contrast, tint and editing single photos are available on a larger screen.
                                        </p>
                                    )}

                                    <div className="photo-editor-adjust-actions">
                                        <button
                                            type="button"
                                            className="forma-btn"
                                            onClick={resetCurrentEdits}
                                            disabled={!hasEdits(currentEdits)}
                                        >
                                            <Icon name="refresh" size={14} /> Reset
                                        </button>
                                        {isEditingSinglePhoto && selectedPhoto.customEdits && (
                                            <button type="button" className="forma-btn" onClick={matchAllPhotos}>
                                                Match all photos
                                            </button>
                                        )}
                                    </div>
                                </fieldset>
                            </div>
                        </aside>
                    </div>

                    <div className="photo-editor-footer">
                        <label className="photo-editor-originals">
                            <input
                                type="checkbox"
                                className="photo-editor-switch"
                                checked={useOriginals}
                                onChange={handleUseOriginalsChange}
                            />
                            Use original photos
                        </label>
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