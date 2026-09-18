// src/CameraCapture.jsx
import { useRef, useState, useEffect, useCallback } from 'react';
import './CameraCapture.css';

const MAX_AUTO_CAPTURES = 100;

function CameraCapture({ onBatchReady, onBack }) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    // A ref to the hidden <input type="file"> clicking a styled button
    // will programmatically "click" this invisible input to open the
    // OS's native file picker popup.
    const fileInputRef = useRef(null);

    const [stream, setStream] = useState(null);
    const [error, setError] = useState(null);
    // Tracks whether the user is currently dragging a file over the
    // drop zone, purely so we can highlight it visually.
    const [isDragging, setIsDragging] = useState(false);
    const [photos, setPhotos] = useState([]);
    //const [feedback, setFeedback] = useState(null);
    const [captureFeedback, setCaptureFeedback] = useState(null);
    const [uploadFeedback, setUploadFeedback] = useState(null);
    const [isBatchSent, setIsBatchSent] = useState(false);

    const [captureMode, setCaptureMode] = useState('manual');
    const [isAutoCapturing, setIsAutoCapturing] = useState(false);
    const [intervalSeconds, setIntervalSeconds] = useState(2);


    useEffect(() => {
        async function startCamera() {
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'environment',
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                });
                setStream(mediaStream);
                if (videoRef.current) {
                    videoRef.current.srcObject = mediaStream;
                }
            } catch (err) {
                // Camera fail to start
                setError('Camera unavailable: ' + err.message);
            }
        }

        startCamera();

        return () => {
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        return () => {
            photos.forEach((photo) => URL.revokeObjectURL(photo.url));
        };
    }, [photos]);

    //function showFeedback(message) {
    //    setFeedback(message);
    //    setTimeout(() => setFeedback(null), 2500);
    //}

    const addFiles = useCallback((fileList) => {
        const newPhotos = Array.from(fileList)
            // Only accept actual images into the batch
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
            // Checks the cap right before capturing, using the functional
            // form of setPhotos indirectly via photos.length.If the cap
            // is hit, this stops the capture instead of taking another photo
            setPhotos((current) => {
                if (current.length >= MAX_AUTO_CAPTURES) {
                    setIsAutoCapturing(false);
                    return current;
                }
                return current;
            });

            capturePhoto(false);
        }, intervalSeconds * 1000);

        return () => clearInterval(id);
    }, [captureMode, isAutoCapturing, intervalSeconds, capturePhoto]);

    function handleModeChange(mode) {
        setCaptureMode(mode);
        // Switching away from auto mode always stops the timer
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
            if (addedCount > 0)
            {
                setUploadFeedback(`${addedCount} photo${addedCount === 1 ? '' : 's'} uploaded`);
                setTimeout(() => setUploadFeedback(null), 2000);
            }
        }
        e.target.value = '';
    }

    // Drag and drop functionality

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

    function handleUploadBatch() {
        const files = photos.map((p) => p.file);
        console.log('Batch selected (not uploaded):', files);
    }

    // "Train model" is the only trigger that starts the reconstruction.
    function handleTrain() {
        const files = photos.map((p) => p.file);
        if (onBatchReady) {
            onBatchReady(files);
        }
        setIsBatchSent(true);
        setTimeout(() => setIsBatchSent(false), 2000)
    }

    const MIN_PHOTOS = 8;

    return (
        <div className="capture">
            <button className="btn btn-ghost capture-back" onClick={onBack}>
                Back
            </button>

            {error && <p className="capture-error">{error}</p>}

            <div className="capture-viewport">
                <video ref={videoRef} autoPlay playsInline muted className="capture-video" />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>

            <div className="capture-mode-toggle">
                <button
                    className={captureMode === 'manual' ? 'btn btn-primary' : 'btn btn-ghost'}
                    onClick={() => handleModeChange('manual')}
                >
                    Manual
                </button>
                <button
                    className={captureMode === 'auto' ? 'btn btn-primary' : 'btn btn-ghost'}
                    onClick={() => handleModeChange('auto')}
                >
                    Auto capture
                </button>
            </div>

            {captureFeedback && <div className="capture-feedback">{captureFeedback}</div>}

            {captureMode === 'manual' ? (
                <button
                    className="btn btn-primary capture-btn"
                    onClick={() => capturePhoto(true)}
                    disabled={!stream}
                >
                    Capture photo
                </button>
            ) : (
                <div className="capture-auto-controls">
                    <button
                        className={isAutoCapturing ? 'btn btn-primary' : 'btn btn-ghost'}
                        onClick={() => setIsAutoCapturing((prev) => !prev)}
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

                    {isAutoCapturing && (
                        <span className="capture-auto-status">
                                Capturing every {intervalSeconds}s… ({photos.length}/{MAX_AUTO_CAPTURES})
                        </span>
                    )}
                </div>
            )}

            <div
                className={isDragging ? 'capture-dropzone is-dragging' : 'capture-dropzone'}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleBrowseClick}
                role="button"
                tabIndex={0}
            >
                <p>Upload Photos</p>
                <p className="capture-dropzone-or">or</p>
                <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleBrowseClick();
                    }}
                >
                    Browse files
                </button>

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
                                onClick={() => removePhoto(photo.id)}
                                aria-label="Remove photo"
                            >
                                x
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* <button
                className={`btn btn-primary batch-btn ${isBatchSent ? 'is-sent' : ''}`}
                disabled={photos.length === 0}
                onClick={handleUploadBatch}
            >
                {isBatchSent ? 'Sent' : `Use this batch (${photos.length} photos)`}
            </button> */}

            {/* "Train model" is the only trigger that starts the reconstruction
                (see handleTrain). Keep this when reworking the layout. */}
            <button
                className="btn btn-primary"
                disabled={photos.length < MIN_PHOTOS}
                onClick={handleTrain}
                style={{ marginTop: '10px' }}
            >
                Train model
            </button>

            {photos.length > 0 && photos.length < MIN_PHOTOS && (
                <p className="capture-count">
                    Add at least {MIN_PHOTOS} photos to train (you have {photos.length}).
                </p>
            )}
        </div>
    );
}

export default CameraCapture;