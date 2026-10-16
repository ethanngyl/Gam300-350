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
auto-capture with a user-adjustable photo cap) beside a batch panel
(drag-and-drop and file-picker uploads, live thumbnails with per-photo
removal, and the button that sends the batch for reconstruction). The
capture, upload and camera-release logic is unchanged from the previous
version; only the markup and styling were redesigned.
**************************************************************************/

import { useRef, useState, useEffect, useCallback } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';
import './CameraCapture.css';

const HARD_CAP = 200;

function CameraCapture({ onBatchReady, onBack, uploadError }) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const fileInputRef = useRef(null);
    const streamRef = useRef(null);

    const [stream, setStream] = useState(null);
    const [error, setError] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [photos, setPhotos] = useState([]);

    const [captureFeedback, setCaptureFeedback] = useState(null);
    const [uploadFeedback, setUploadFeedback] = useState(null);
    const [isBatchSent, setIsBatchSent] = useState(false);

    const [captureMode, setCaptureMode] = useState('manual');
    const [isAutoCapturing, setIsAutoCapturing] = useState(false);
    const [intervalSeconds, setIntervalSeconds] = useState(2);
    const [maxCaptures, setMaxCaptures] = useState(50);

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
    }, []);

    useEffect(() => {
        return () => {
            photos.forEach((photo) => URL.revokeObjectURL(photo.url));
        };
    }, [photos]);

    const addFiles = useCallback((fileList) => {
        const newPhotos = Array.from(fileList)
            .filter((file) => file.type.startsWith('image/'))
            .map((file) => ({
                id: `${file.name}-${file.lastModified}-${Math.random()}`,
                url: URL.createObjectURL(file),
                file,
            }));

        setPhotos((prev) => [...prev, ...newPhotos]);

        return newPhotos.length;
    }, []);

    const capturePhoto = useCallback((showFeedback = true) => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

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

    function removePhoto(id) {
        setPhotos((prev) => prev.filter((p) => p.id !== id));
    }

    // "Train model" is the only trigger that starts the reconstruction.
    function handleTrain() {
        const files = photos.map((p) => p.file);
        if (onBatchReady) {
            onBatchReady(files);
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
                        playSound('click3');
                        onBack();
                    }}
                >
                    Back to dashboard
                </button>
            </div>

            <div className="capture-layout">
                <div className="forma-card capture-camera">
                    <div className="capture-viewport">
                        <video ref={videoRef} autoPlay playsInline muted className="capture-video" />
                        <canvas ref={canvasRef} style={{ display: 'none' }} />

                        {!stream && (
                            <div className="capture-placeholder">
                                <Icon name="camera" size={34} />
                                <span>{error ? 'Camera not available' : 'Waiting for camera...'}</span>
                            </div>
                        )}

                        <span className="capture-corner capture-corner-tl"></span>
                        <span className="capture-corner capture-corner-tr"></span>
                        <span className="capture-corner capture-corner-bl"></span>
                        <span className="capture-corner capture-corner-br"></span>

                        <span className={stream ? 'capture-live is-live' : 'capture-live'}>
                            <span className="capture-live-dot"></span>
                            {stream ? 'Live' : 'Offline'}
                        </span>
                    </div>

                    {error && <p className="capture-error">{error}</p>}

                    {captureFeedback && <div className="capture-feedback">{captureFeedback}</div>}

                    <div className="capture-controls">
                        <div className="capture-mode-toggle">
                            <button
                                className={captureMode === 'manual' ? 'capture-mode-btn is-active' : 'capture-mode-btn'}
                                onClick={() => {
                                    playSound('click');
                                    handleModeChange('manual');
                                }}
                            >
                                Manual
                            </button>
                            <button
                                className={captureMode === 'auto' ? 'capture-mode-btn is-active' : 'capture-mode-btn'}
                                onClick={() => {
                                    playSound('click');
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
                                    playSound('click');
                                    capturePhoto(true);
                                }}
                                disabled={!stream}
                            >
                                <Icon name="camera" size={16} /> Capture photo
                            </button>
                        ) : (
                            <div className="capture-auto-controls">
                                <button
                                    className={isAutoCapturing ? 'forma-btn forma-btn-primary' : 'forma-btn'}
                                    onClick={() => {
                                        playSound('click');
                                        setIsAutoCapturing((prev) => !prev);
                                    }}
                                    disabled={!stream}
                                >
                                    {isAutoCapturing ? 'Stop auto-capture' : 'Start auto-capture'}
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
                    </div>
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
                            playSound('click');
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
                                playSound('click');
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

                    {uploadFeedback && <div className="capture-feedback">{uploadFeedback}</div>}

                    <span className="capture-count">{photos.length} photo{photos.length === 1 ? '' : 's'} in batch</span>

                    {photos.length > 0 && (
                        <div className="capture-thumbnails">
                            {photos.map((photo) => (
                                <div key={photo.id} className="capture-thumb">
                                    <img src={photo.url} alt="" />
                                    <button
                                        className="capture-thumb-remove"
                                        onClick={() => {
                                            playSound('click');
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

                    <button
                        className={`forma-btn forma-btn-primary batch-btn ${isBatchSent ? 'is-sent' : ''}`}
                        disabled={photos.length === 0}
                        onClick={() => {
                            playSound('click');
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