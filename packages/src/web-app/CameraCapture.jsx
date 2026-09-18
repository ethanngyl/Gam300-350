// src/CameraCapture.jsx
import { useRef, useState, useEffect, useCallback } from 'react';
import './CameraCapture.css';

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
    const [feedback, setFeedback] = useState(null);

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
                // Camera failing to start (denied permission, no camera, etc.)
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

    function showFeedback(message) {
        setFeedback(message);
        setTimeout(() => setFeedback(null), 2500);
    }

    const addFiles = useCallback((fileList) => {
        const newPhotos = Array.from(fileList)
            // Only accept actual images into the batch.
            .filter((file) => file.type.startsWith('image/'))
            .map((file) => ({
                id: `${file.name}-${file.lastModified}-${Math.random()}`,
                url: URL.createObjectURL(file),
                file,
            }));

        setPhotos((prev) => [...prev, ...newPhotos]);

        if (newPhotos.length > 0) {
            showFeedback(`${newPhotos.length} photo${newPhotos.length === 1 ? '' : 's'} added`);
        }
    }, []);

    const capturePhoto = useCallback(() => {
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
            },
            'image/jpeg',
            0.9
        );
    }, [addFiles]);

    function handleBrowseClick() {
        fileInputRef.current?.click();
    }

    function handleFileInputChange(e) {
        if (e.target.files) {
            addFiles(e.target.files);
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
            addFiles(e.dataTransfer.files);
        }
    }

    function removePhoto(id) {
        setPhotos((prev) => prev.filter((p) => p.id !== id));
    }

    function handleUploadBatch() {
        const files = photos.map((p) => p.file);
            if (onBatchReady) {
            onBatchReady(files);   // ← THIS is what uploads
        }
        console.log('Batch selected (not uploaded):', files);
    }

    // "Train model" is the only trigger that starts the reconstruction.
    function handleTrain() {
        const files = photos.map((p) => p.file);
        if (onBatchReady) {
            onBatchReady(files);
        }
    }

    const MIN_PHOTOS = 8;

    return (
        <div className="capture">
            <button className="btn btn-ghost capture-back" onClick={onBack}>
                Back
            </button>
            {feedback && <div className="capture-feedback">{feedback}</div>}

            {error && <p className="capture-error">{error}</p>}

            <div className="capture-viewport">
                <video ref={videoRef} autoPlay playsInline muted className="capture-video" />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>

            <button
                className="btn btn-primary capture-btn"
                onClick={capturePhoto}
                disabled={!stream}
            >
                Capture photo
            </button>

            {/* Drag-and-drop zone and file picker */}
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
                              
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <button
                className="btn btn-primary"
                disabled={photos.length === 0}
                onClick={handleUploadBatch}
            >
                Use this batch ({photos.length} photos)
            </button>

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
