import { useRef, useState, useEffect, useCallback } from 'react';
import './CameraCapture.css';

function CameraCapture({ onBatchReady }) {
    // Refs point directly at DOM elements — the <video> tag showing the
    // live camera feed, and a hidden <canvas> we use to "screenshot" a
    // single frame out of that video when the user taps capture.
    const videoRef = useRef(null);
    const canvasRef = useRef(null);

    // The camera's live feed, once permission is granted.
    const [stream, setStream] = useState(null);
    // Each captured photo, stored as a data URL (base64 image string)
    // so we can both display a thumbnail AND later convert it to a
    // file for upload.
    const [photos, setPhotos] = useState([]);
    const [error, setError] = useState(null);

    // Ask the browser for camera access as soon as this component mounts.
    useEffect(() => {
        async function startCamera() {
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        // 'environment' = the back/rear camera, which is what you
                        // want for scanning an object (not the selfie camera).
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
                // Common causes: user denied permission, no camera present,
                // or the page isn't served over HTTPS (browsers block camera
                // access on plain HTTP except on localhost).
                setError('Camera access failed: ' + err.message);
            }
        }

        startCamera();

        // Cleanup: when this component unmounts (user navigates away),
        // stop the camera so the browser's "camera in use" indicator
        // turns off and the hardware is released.
        return () => {
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const capturePhoto = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        // Size the hidden canvas to match the video's actual resolution,
        // then draw the CURRENT frame onto it — this is how you "freeze"
        // one moment of a live video feed into a still image.
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Convert the canvas's pixels into a JPEG data URL we can store
        // in state and display as a thumbnail.
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

        setPhotos((prev) => [...prev, dataUrl]);
    }, []);

    const retakeLast = useCallback(() => {
        setPhotos((prev) => prev.slice(0, -1));
    }, []);

    const removePhoto = useCallback((index) => {
        setPhotos((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // Turns each data URL back into a real file object, ready to be
    // sent as multipart form data to Ethan/Gabriel's POST /upload
    // endpoint once it exists.
    async function dataUrlToFile(dataUrl, filename) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return new File([blob], filename, { type: 'image/jpeg' });
    }

    async function handleUploadBatch() {
        const files = await Promise.all(
            photos.map((dataUrl, i) => dataUrlToFile(dataUrl, `photo-${i}.jpg`))
        );

        // Hand the finished batch up to whatever parent component owns
        // the upload flow — keeps this component only responsible for
        // capturing, not for knowing about the backend.
        if (onBatchReady) {
            onBatchReady(files);
        }
    }

    return (
        <div className="capture">
            {error && <p className="capture-error">{error}</p>}

            <div className="capture-viewport">
                {/* autoPlay + playsInline are required for the live feed to
            actually show on mobile Safari/Chrome without extra taps. */}
                <video ref={videoRef} autoPlay playsInline muted className="capture-video" />
                {/* This canvas is never shown — it's just scratch space used
            inside capturePhoto() to grab a frame. */}
                <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>

            <div className="capture-controls">
                <button
                    className="btn btn-primary capture-btn"
                    onClick={capturePhoto}
                    disabled={!stream}
                >
                    Capture photo
                </button>
                <span className="capture-count">{photos.length} captured</span>
                {photos.length > 0 && (
                    <button className="btn btn-ghost" onClick={retakeLast}>
                        Retake last
                    </button>
                )}
            </div>

            {photos.length > 0 && (
                <div className="capture-thumbnails">
                    {photos.map((src, i) => (
                        <div key={i} className="capture-thumb">
                            <img src={src} alt={`capture ${i + 1}`} />
                            <button
                                className="capture-thumb-remove"
                                onClick={() => removePhoto(i)}
                                aria-label={`Remove photo ${i + 1}`}
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