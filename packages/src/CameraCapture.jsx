// src/CameraCapture.jsx
import { useRef, useState, useEffect, useCallback } from 'react';
import './CameraCapture.css';

function CameraCapture({ onBatchReady }) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    // A ref to the hidden <input type="file"> — clicking a styled button
    // will programmatically "click" this invisible input to open the
    // OS's native file picker popup.
    const fileInputRef = useRef(null);

    const [stream, setStream] = useState(null);
    const [error, setError] = useState(null);

    // Tracks whether the user is currently dragging a file over the
    // drop zone, purely so we can highlight it visually.
    const [isDragging, setIsDragging] = useState(false);

    const [photos, setPhotos] = useState([]);

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
            onBatchReady(files);
        }
    }

    return (
        <div className="capture">
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

            {/* Drag-and-drop zone + file picker */}
            <div
                className={isDragging ? 'capture-dropzone is-dragging' : 'capture-dropzone'}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleBrowseClick}
                role="button"
                tabIndex={0}
            >
                <p>Drag and drop images here</p>
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
                                ×
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
        </div>
    );
}

export default CameraCapture;
