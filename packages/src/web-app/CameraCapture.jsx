/*!************************************************************************
\file CameraCapture.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
In-browser photo capture screen for scanning an object, laid out to match
the GENESIS theme: a camera panel (live preview, manual or interval-based
auto-capture with a user-adjustable photo cap, and the Space key as a
shortcut for both) beside a batch panel
(drag-and-drop and file-picker uploads, live thumbnails with per-photo
removal, and the button that sends the batch for reconstruction).
Each photo is checked in the background for blur, bad exposure and
near-duplicates (PhotoChecks.js). Flagged photos are outlined, and a note
suggests "Review photos first", which opens the batch in the Photo Editor.
Taking a photo plays the camera shutter sound (quieter for auto-capture).
Cameras that allow it start in autofocus; tapping the preview focuses on
that spot, and a Focus slider sets the focus by hand.
If the camera can't start, the preview reads "Click to enable camera" and
clicking it asks for the camera again. The Remove background option and
the Model detail slider (training iteration cap) are here and in the Photo
Editor; coming back from there ("Back to camera"), initialPhotos brings
the batch and those choices back with it.
**************************************************************************/

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';
import './CameraCapture.css';
import LibraryPhotoPicker from './LibraryPhotoPicker.jsx';
import { analyzePhoto, findPhotoIssues } from './PhotoChecks.js';
import TrainingQualitySlider from './TrainingQualitySlider.jsx';
import { DEFAULT_TRAINING_ITERATIONS } from './TrainingPresets.js';

const HARD_CAP = 200;

// Space is the capture shortcut, except while typing or on a focused
// control outside the camera panel, where it keeps its normal job (e.g.
// pressing that button). The camera's own buttons always use the shortcut.
function isShortcutBlockedBy(target) {
    if (target.closest?.('.capture-controls')) return false;
    return Boolean(target.closest?.('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]'));
}

// Builds the warning above the buttons, e.g. "3 look blurry, 2 are near-duplicates".
const ISSUE_SUMMARY_PHRASES = {
    blurry: (count) => `${count} look${count === 1 ? 's' : ''} blurry`,
    duplicate: (count) => `${count} ${count === 1 ? 'is a near-duplicate' : 'are near-duplicates'}`,
    dark: (count) => `${count} ${count === 1 ? 'is' : 'are'} too dark`,
    bright: (count) => `${count} ${count === 1 ? 'is' : 'are'} too bright`,
};

// What focus control the camera offers: continuous autofocus, focusing on a
// tapped point, and/or a manual focus distance. Phone cameras usually offer
// some of these; many desktop webcams offer none (they keep their own focus).
function readFocusSupport(track) {
    const capabilities = track.getCapabilities?.() ?? {};
    const focusModes = capabilities.focusMode ?? [];
    const canFocusOnPoint = Boolean(navigator.mediaDevices.getSupportedConstraints?.().pointsOfInterest);
    return {
        autoMode: focusModes.includes('continuous') ? 'continuous' : focusModes.includes('single-shot') ? 'single-shot' : null,
        canTapFocus: canFocusOnPoint && (focusModes.includes('continuous') || focusModes.includes('single-shot')),
        distanceRange: focusModes.includes('manual') && capabilities.focusDistance ? capabilities.focusDistance : null,
    };
}

// Turns a click on the preview into a point on the camera frame (0-1 on
// each axis). The preview is cropped to fill its box (object-fit: cover),
// so the hidden overflow is added back before dividing.
function clickToFramePoint(event, video) {
    const rect = video.getBoundingClientRect();
    const scale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const shownWidth = video.videoWidth * scale;
    const shownHeight = video.videoHeight * scale;
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    return {
        frame: {
            x: Math.min(1, Math.max(0, (clickX + (shownWidth - rect.width) / 2) / shownWidth)),
            y: Math.min(1, Math.max(0, (clickY + (shownHeight - rect.height) / 2) / shownHeight)),
        },
        // Where to draw the focus ring, as a percentage of the preview.
        ring: { left: (clickX / rect.width) * 100, top: (clickY / rect.height) * 100 },
    };
}

// Builds one batch entry. Checks start as 'pending'.
function createBatchPhoto(file) {
    return {
        id: `${file.name}-${file.lastModified}-${Math.random()}`,
        url: URL.createObjectURL(file),
        file,
        analysisStatus: 'pending',
        analysis: null,
    };
}

// addedFiles: photos chosen with the sidebar's Add photos button before
// this page opened; they start in the batch. While the page is open,
// onRegisterAddFiles(handler) hands App a function that adds more.
// initialPhotos: { files, removeBackground, trainIters } handed back from the Photo
// Editor, or null when the page is opened fresh.
function CameraCapture({
    onBatchReady,
    onReviewPhotos,
    onBack,
    uploadError,
    initialPhotos = null,
    addedFiles = null,
    onRegisterAddFiles = null,
}) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const fileInputRef = useRef(null);
    const streamRef = useRef(null);
    // Latest photo list, read when the page closes to release preview URLs.
    const photosRef = useRef([]);
    // Id of the photo currently being checked, so only one runs at a time.
    const analyzingPhotoIdRef = useRef(null);

    const [stream, setStream] = useState(null);
    const [error, setError] = useState(null);
    // Bumped by "Click to enable camera" to ask for the camera again.
    const [cameraRequestCount, setCameraRequestCount] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [photos, setPhotos] = useState(() =>
        [...(initialPhotos?.files ?? []), ...(addedFiles ?? [])]
            .filter((file) => file.type.startsWith('image/'))
            .map(createBatchPhoto)
    );

    const [captureFeedback, setCaptureFeedback] = useState(null);
    const [uploadFeedback, setUploadFeedback] = useState(null);
    const [isBatchSent, setIsBatchSent] = useState(false);

    const [captureMode, setCaptureMode] = useState('manual');
    const [isAutoCapturing, setIsAutoCapturing] = useState(false);
    const [intervalSeconds, setIntervalSeconds] = useState(2);
    const [maxCaptures, setMaxCaptures] = useState(50);
    // Mask out the background before reconstruction. Needed for turntable
    // captures, where the static background makes the model come out flat.
    // Also set in the Photo Editor, and kept when coming back from it.
    const [removeBackground, setRemoveBackground] = useState(initialPhotos?.removeBackground ?? false);
    // Model detail (training iteration cap), also set in the Photo Editor.
    const [trainIters, setTrainIters] = useState(initialPhotos?.trainIters ?? DEFAULT_TRAINING_ITERATIONS);

    const [isLibraryPickerOpen, setIsLibraryPickerOpen] = useState(false);

    // Focus: what the current camera supports (null until it starts),
    // 'auto' or 'manual', the manual focus distance, the ring drawn where
    // the preview was tapped, and a short note when focusing isn't possible.
    const [focusSupport, setFocusSupport] = useState(null);
    const [focusMode, setFocusMode] = useState('auto');
    const [focusDistance, setFocusDistance] = useState(null);
    const [focusRing, setFocusRing] = useState(null);
    const [focusNote, setFocusNote] = useState(null);
    const focusRingTimerRef = useRef(null);
    const focusNoteTimerRef = useRef(null);

    useEffect(() => {
        let cancelled = false;

        async function startCamera() {
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'environment',
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                });

                if (cancelled) {
                    mediaStream.getTracks().forEach((track) => track.stop());
                    return;
                }

                streamRef.current = mediaStream;
                setStream(mediaStream);

                // See what focus control this camera has and switch it to
                // autofocus, so photos start sharp without the user doing anything.
                const track = mediaStream.getVideoTracks()[0];
                const support = readFocusSupport(track);
                setFocusSupport(support);
                setFocusMode('auto');
                setFocusDistance(track.getSettings?.().focusDistance ?? support.distanceRange?.min ?? null);
                if (support.autoMode) {
                    track.applyConstraints({ advanced: [{ focusMode: support.autoMode }] }).catch(() => {});
                }
                if (videoRef.current) {
                    videoRef.current.srcObject = mediaStream;
                }
            } catch (err) {
                if (!cancelled) {
                    setError('Camera unavailable: ' + err.message);
                }
            }
        }

        startCamera();

        return () => {
            cancelled = true;
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
                streamRef.current = null;
            }
        };
    }, [cameraRequestCount]);

    function retryCamera() {
        playSound('tap');
        setError(null);
        setCameraRequestCount((count) => count + 1);
    }

    useEffect(() => {
        return () => {
            clearTimeout(focusRingTimerRef.current);
            clearTimeout(focusNoteTimerRef.current);
        };
    }, []);

    function showFocusNote(note) {
        setFocusNote(note);
        clearTimeout(focusNoteTimerRef.current);
        focusNoteTimerRef.current = setTimeout(() => setFocusNote(null), 2500);
    }

    // Tap / click the preview to focus on that spot. Goes back to autofocus
    // (centred on the spot) if the manual slider was in use.
    async function handlePreviewClick(event) {
        const video = videoRef.current;
        const track = streamRef.current?.getVideoTracks()[0];
        if (!stream || !track || !video?.videoWidth) return;

        if (!focusSupport?.canTapFocus) {
            showFocusNote('This camera adjusts its own focus');
            return;
        }

        const { frame, ring } = clickToFramePoint(event, video);
        playSound('tap', 0.5);
        setFocusRing({ ...ring, id: Date.now() });
        clearTimeout(focusRingTimerRef.current);
        focusRingTimerRef.current = setTimeout(() => setFocusRing(null), 1200);

        try {
            await track.applyConstraints({
                advanced: [{ focusMode: focusSupport.autoMode, pointsOfInterest: [frame] }],
            });
            setFocusMode('auto');
        } catch {
            showFocusNote("Couldn't focus there");
        }
    }

    function handleAutoFocus() {
        const track = streamRef.current?.getVideoTracks()[0];
        if (!track || !focusSupport?.autoMode) return;
        playSound('tap');
        track.applyConstraints({ advanced: [{ focusMode: focusSupport.autoMode }] })
            .then(() => setFocusMode('auto'))
            .catch(() => showFocusNote("Couldn't switch to autofocus"));
    }

    function handleFocusDistanceChange(distance) {
        const track = streamRef.current?.getVideoTracks()[0];
        if (!track) return;
        setFocusDistance(distance);
        setFocusMode('manual');
        track.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: distance }] })
            .catch(() => showFocusNote("Couldn't set the focus"));
    }

    useEffect(() => {
        photosRef.current = photos;
    }, [photos]);

    // Release every thumbnail URL when the page closes. (Removed photos
    // release theirs in removePhoto.)
    useEffect(() => {
        return () => {
            photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
        };
    }, []);

    // Check pending photos one at a time, same as the Photo Editor. Each
    // finished check updates the list, which starts the next one.
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
    const flaggedCount = photos.filter((photo) => issuesById[photo.id]?.length > 0).length;
    const isChecking = photos.some((photo) => photo.analysisStatus === 'pending');

    // "3 look blurry, 2 are near-duplicates", or null when nothing is flagged.
    const issueSummary = useMemo(() => {
        const countsByIssue = {};
        Object.values(issuesById).flat().forEach((issue) => {
            countsByIssue[issue] = (countsByIssue[issue] ?? 0) + 1;
        });
        const phrases = Object.keys(ISSUE_SUMMARY_PHRASES)
            .filter((issue) => countsByIssue[issue] > 0)
            .map((issue) => ISSUE_SUMMARY_PHRASES[issue](countsByIssue[issue]));
        return phrases.length > 0 ? phrases.join(', ') : null;
    }, [issuesById]);

    const addFiles = useCallback((fileList) => {
        const newPhotos = Array.from(fileList)
            .filter((file) => file.type.startsWith('image/'))
            .map(createBatchPhoto);

        setPhotos((prev) => [...prev, ...newPhotos]);

        return newPhotos.length;
    }, []);

    // While this page is open, the sidebar's Add photos button adds to
    // this batch through the handler registered here.
    useEffect(() => {
        if (!onRegisterAddFiles) return;
        onRegisterAddFiles((files) => {
            const addedCount = addFiles(files);
            if (addedCount > 0) {
                setUploadFeedback(`${addedCount} photo${addedCount === 1 ? '' : 's'} uploaded`);
                setTimeout(() => setUploadFeedback(null), 2000);
            }
        });
        return () => onRegisterAddFiles(null);
    }, [onRegisterAddFiles, addFiles]);

    const capturePhoto = useCallback((showFeedback = true) => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // Shutter sound the moment the frame is grabbed. Quieter for
        // auto-capture, which repeats every few seconds.
        playSound('camera', showFeedback ? 1 : 0.5);

        canvas.toBlob(
            (blob) => {
                if (!blob) return;
                const file = new File([blob], `capture-${Date.now()}.jpg`, {
                    type: 'image/jpeg',
                });
                addFiles([file]);

                if (showFeedback) {
                    setCaptureFeedback('Photo captured');
                    setTimeout(() => setCaptureFeedback(null), 2000);
                }
            },
            'image/jpeg',
            0.9
        );
    }, [addFiles]);

    useEffect(() => {
        if (captureMode !== 'auto' || !isAutoCapturing) return;

        const id = setInterval(() => {
            if (photos.length >= maxCaptures) {
                setIsAutoCapturing(false);
                return;
            }
            capturePhoto(false);
        }, intervalSeconds * 1000);

        return () => clearInterval(id);
    }, [captureMode, isAutoCapturing, intervalSeconds, maxCaptures, capturePhoto, photos.length]);

    // Space: take a photo in Manual mode, start / stop in Auto mode.
    useEffect(() => {
        function handleKeyDown(event) {
            if (event.code !== 'Space' || event.repeat || !stream) return;
            if (isLibraryPickerOpen || isShortcutBlockedBy(event.target)) return;
            event.preventDefault();
            // A focused camera button would otherwise also be pressed on key-up.
            if (event.target.closest?.('.capture-controls')) event.target.blur();
            if (captureMode === 'manual') {
                capturePhoto(true);
            } else {
                playSound('tap');
                setIsAutoCapturing((wasCapturing) => !wasCapturing);
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [captureMode, stream, capturePhoto, isLibraryPickerOpen]);

    function handleModeChange(mode) {
        setCaptureMode(mode);
        if (mode === 'manual') {
            setIsAutoCapturing(false);
        }
    }

    function handleBrowseClick() {
        fileInputRef.current?.click();
    }

    function handleFileInputChange(e) {
        if (e.target.files) {
            const addedCount = addFiles(e.target.files);
            if (addedCount > 0) {
                setUploadFeedback(`${addedCount} photo${addedCount === 1 ? '' : 's'} uploaded`);
                setTimeout(() => setUploadFeedback(null), 2000);
            }
        }

        e.target.value = '';
    }

    function handleDragOver(e) {
        e.preventDefault();
        setIsDragging(true);
    }

    function handleDragLeave() {
        setIsDragging(false);
    }

    function handleDrop(e) {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files) {
            const addedCount = addFiles(e.dataTransfer.files);
            if (addedCount > 0) {
                setUploadFeedback(`${addedCount} photo${addedCount === 1 ? '' : 's'} uploaded`);
                setTimeout(() => setUploadFeedback(null), 2000);
            }
        }
    }
    function handleLibraryPhotos(files) {
        const addedCount = addFiles(files);
        if (addedCount > 0) {
            setUploadFeedback(`${addedCount} photo${addedCount === 1 ? '' : 's'} added from library`);
            setTimeout(() => setUploadFeedback(null), 2000);
        }
    }

    function removePhoto(id) {
        const removedPhoto = photos.find((p) => p.id === id);
        if (removedPhoto) URL.revokeObjectURL(removedPhoto.url);
        setPhotos((prev) => prev.filter((p) => p.id !== id));
    }

    // Opens the batch in the Photo Editor. App switches tabs, which closes
    // this page and releases the thumbnails; the File objects stay valid.
    function handleReview() {
        setIsAutoCapturing(false);
        onReviewPhotos(photos.map((p) => p.file), { removeBackground, trainIters });
    }

    // "Train model" is the only trigger that starts the reconstruction.
    function handleTrain() {
        const files = photos.map((p) => p.file);
        if (onBatchReady) {
            onBatchReady(files, { removeBackground, trainIters });
        }

        setIsBatchSent(true);
        setTimeout(() => setIsBatchSent(false), 2000);
    }

    return (
        <div className="capture-page">
            <div className="capture-heading">
                <div>
                    <div className="eyebrow eyebrow-accent">Start a new project</div>
                    <h1 className="capture-title">Create a 3D model from photos</h1>
                    <p className="capture-subtitle">
                        Capture photos of your object from every angle, or upload photos you
                        already have. Then send the batch to build your model.
                    </p>
                </div>
                <button
                    className="forma-btn capture-back"
                    onClick={() => {
                        playSound('back');
                        onBack();
                    }}
                >
                    Back to dashboard
                </button>
            </div>

            <div className="capture-layout">
                <div className="forma-card capture-camera">
                    <div
                        className={focusSupport?.canTapFocus ? 'capture-viewport can-tap-focus' : 'capture-viewport'}
                        onClick={handlePreviewClick}
                    >
                        <video ref={videoRef} autoPlay playsInline muted className="capture-video" />
                        <canvas ref={canvasRef} style={{ display: 'none' }} />

                        {!stream && !error && (
                            <div className="capture-placeholder">
                                <Icon name="camera" size={34} />
                                <span>Waiting for camera...</span>
                            </div>
                        )}
                        {!stream && error && (
                            <button type="button" className="capture-placeholder capture-enable" onClick={retryCamera}>
                                <Icon name="camera" size={34} />
                                <span>Camera not available</span>
                                <span className="capture-enable-hint">Click to enable camera</span>
                            </button>
                        )}

                        <span className="capture-corner capture-corner-tl"></span>
                        <span className="capture-corner capture-corner-tr"></span>
                        <span className="capture-corner capture-corner-bl"></span>
                        <span className="capture-corner capture-corner-br"></span>

                        {stream && (
                            <span className="capture-live is-live">
                                <span className="capture-live-dot"></span>
                                Live
                            </span>
                        )}

                        {focusRing && (
                            <span
                                key={focusRing.id}
                                className="capture-focus-ring"
                                style={{ left: `${focusRing.left}%`, top: `${focusRing.top}%` }}
                            ></span>
                        )}
                        {stream && focusSupport?.canTapFocus && !focusNote && (
                            <span className="capture-focus-hint">Tap to focus</span>
                        )}
                        {focusNote && <span className="capture-focus-hint" role="status">{focusNote}</span>}
                    </div>

                    {error && <p className="capture-error">{error}</p>}

                    <div className="capture-controls">
                        <div className="capture-mode-toggle">
                            <button
                                className={captureMode === 'manual' ? 'capture-mode-btn is-active' : 'capture-mode-btn'}
                                onClick={() => {
                                    playSound('tap');
                                    handleModeChange('manual');
                                }}
                            >
                                Manual
                            </button>
                            <button
                                className={captureMode === 'auto' ? 'capture-mode-btn is-active' : 'capture-mode-btn'}
                                onClick={() => {
                                    playSound('tap');
                                    handleModeChange('auto');
                                }}
                            >
                                Auto capture
                            </button>
                        </div>

                        {captureMode === 'manual' ? (
                            <button
                                className="forma-btn capture-btn"
                                onClick={() => {
                                    capturePhoto(true);
                                }}
                                disabled={!stream}
                            >
                                <Icon name="camera" size={16} /> Capture photo
                                <kbd className="capture-key">Space</kbd>
                            </button>
                        ) : (
                            <div className="capture-auto-controls">
                                <button
                                    className={isAutoCapturing ? 'forma-btn capture-btn is-capturing' : 'forma-btn capture-btn'}
                                    onClick={() => {
                                        playSound('tap');
                                        setIsAutoCapturing((prev) => !prev);
                                    }}
                                    disabled={!stream}
                                >
                                    <Icon name="camera" size={16} />
                                    {isAutoCapturing ? ' Stop auto-capture' : ' Start auto-capture'}
                                    <kbd className="capture-key">Space</kbd>
                                </button>

                                <label className="capture-interval-label">
                                    every
                                    <select
                                        value={intervalSeconds}
                                        onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                                        disabled={isAutoCapturing}
                                    >
                                        <option value={1}>1s</option>
                                        <option value={2}>2s</option>
                                        <option value={3}>3s</option>
                                        <option value={5}>5s</option>
                                    </select>
                                </label>

                                <label className="capture-interval-label">
                                    max
                                    <select
                                        value={maxCaptures}
                                        onChange={(e) => setMaxCaptures(Number(e.target.value))}
                                        disabled={isAutoCapturing}
                                    >
                                        <option value={10}>10</option>
                                        <option value={25}>25</option>
                                        <option value={50}>50</option>
                                        <option value={100}>100</option>
                                        <option value={HARD_CAP}>{HARD_CAP}</option>
                                    </select>
                                </label>

                                {isAutoCapturing && (
                                    <span className="capture-auto-status">
                                        Capturing every {intervalSeconds}s... ({photos.length}/{maxCaptures})
                                    </span>
                                )}
                            </div>
                        )}

                        {/* Manual focus, only for cameras that allow it. */}
                        {stream && focusSupport?.distanceRange && (
                            <div className="capture-focus-controls">
                                <span className="capture-interval-label">focus</span>
                                <button
                                    type="button"
                                    className={focusMode === 'auto' ? 'capture-mode-btn is-active' : 'capture-mode-btn'}
                                    onClick={handleAutoFocus}
                                    disabled={!focusSupport.autoMode}
                                >
                                    Auto
                                </button>
                                <input
                                    type="range"
                                    className="capture-focus-slider"
                                    aria-label="Manual focus distance"
                                    min={focusSupport.distanceRange.min}
                                    max={focusSupport.distanceRange.max}
                                    step={focusSupport.distanceRange.step || 0.01}
                                    value={focusDistance ?? focusSupport.distanceRange.min}
                                    onChange={(e) => handleFocusDistanceChange(Number(e.target.value))}
                                />
                            </div>
                        )}
                    </div>

                    {/* Below the buttons, so showing it doesn't push them down. */}
                    {captureFeedback && <div className="capture-feedback">{captureFeedback}</div>}
                </div>

                <div className="forma-card capture-batch">
                    <div>
                        <div className="eyebrow">Batch</div>
                        <h2 className="capture-batch-title">Source photos</h2>
                    </div>

                    <div
                        className={isDragging ? 'capture-dropzone is-dragging' : 'capture-dropzone'}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => {
                            playSound('tap');
                            handleBrowseClick();
                        }}
                        role="button"
                        tabIndex={0}
                    >
                        <Icon name="image" size={26} />
                        <p>Upload Photos</p>
                        <p className="capture-dropzone-or">or</p>
                        <button
                            type="button"
                            className="forma-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                playSound('tap');
                                handleBrowseClick();
                            }}
                        >
                            Browse files
                        </button>
                        <span className="capture-dropzone-types">JPG - PNG - WEBP - HEIC</span>

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleFileInputChange}
                            style={{ display: 'none' }}
                        />
                    </div>

                    <button
                        type="button"
                        className="forma-btn capture-library-btn"
                        onClick={() => {
                            playSound('tap');
                            setIsLibraryPickerOpen(true);
                        }}
                    >
                        <Icon name="layers" size={14} /> Add from library
                    </button>

                    {isLibraryPickerOpen && (
                        <LibraryPhotoPicker
                            onAddFiles={handleLibraryPhotos}
                            onClose={() => setIsLibraryPickerOpen(false)}
                        />
                    )}

                    {uploadFeedback && <div className="capture-feedback">{uploadFeedback}</div>}

                    <span className="capture-count">{photos.length} photo{photos.length === 1 ? '' : 's'} in batch</span>

                    {photos.length > 0 && (
                        <div className="capture-thumbnails">
                            {photos.map((photo) => (
                                <div
                                    key={photo.id}
                                    className={issuesById[photo.id]?.length > 0 ? 'capture-thumb has-issue' : 'capture-thumb'}
                                    title={issuesById[photo.id]?.length > 0 ? 'Flagged: open Review photos first to see why' : undefined}
                                >
                                    <img src={photo.url} alt="" />
                                    <button
                                        className="capture-thumb-remove"
                                        onClick={() => {
                                            playSound('tap');
                                            removePhoto(photo.id);
                                        }}
                                        aria-label="Remove photo"
                                    >
                                        <Icon name="plus" size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <label className="capture-option">
                        <input
                            type="checkbox"
                            checked={removeBackground}
                            onChange={(e) => {
                                playSound('tap');
                                setRemoveBackground(e.target.checked);
                            }}
                        />
                        <span>
                            Remove background
                            <small>Turn on for turntable captures (object spins, camera stays still).</small>
                        </span>
                    </label>

                    <TrainingQualitySlider iterations={trainIters} onChange={setTrainIters} />

                    {issueSummary && (
                        <p className="capture-issues" role="status">
                            <Icon name="triangle" size={14} />
                            <span>
                                {flaggedCount} of {photos.length} photos may hurt your model: {issueSummary}.
                                Review them before building.
                            </span>
                        </p>
                    )}
                    {!issueSummary && isChecking && photos.length > 1 && (
                        <p className="capture-checking">Checking photos...</p>
                    )}

                    <button
                        className={issueSummary ? 'forma-btn batch-review-btn is-suggested' : 'forma-btn batch-review-btn'}
                        disabled={photos.length === 0}
                        onClick={() => {
                            playSound('confirm');
                            handleReview();
                        }}
                    >
                        <Icon name="edit" size={14} /> Review photos first
                    </button>

                    <button
                        className={`forma-btn forma-btn-primary batch-btn ${isBatchSent ? 'is-sent' : ''}`}
                        disabled={photos.length === 0}
                        onClick={() => {
                            playSound('confirm');
                            handleTrain();
                        }}
                    >
                        {isBatchSent ? 'Sent' : `Use this batch (${photos.length} photos)`}
                    </button>

                    {uploadError && <p className="capture-error" role="alert">{uploadError}</p>}
                </div>
            </div>
        </div>
    );
}

export default CameraCapture;