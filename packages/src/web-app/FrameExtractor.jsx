/*!************************************************************************
\file FrameExtractor.jsx
\author1 Ethan Ng Yong Le
\author2 Bryan Lim Jun Jie
\par DP email1: n.ethanyongle@digipen.edu
\par DP email2: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Lets the user choose media files (videos or animated GIFs), and set a
frame-extraction rate, the Remove background option (on by default) and model
detail (training iteration cap, via TrainingQualitySlider). The drop zone,
chosen files, fps and "Process media" share one box, with a note under it on
how frames are picked.
"Process media" hands the files and settings to App through
onStartBuild({ files, fps, trainIters, removeBackground }). App opens the
full-screen processing screen (Processing.jsx), the same one photo builds
use, which shows the upload as its first step and then the build's progress;
a finished model opens on the model page. The file rules and the upload live
in mediaJobs.js. There is no Back button; the dock handles navigation.
- FrameExtractor({ onStartBuild, initialDraft, notice })
initialDraft ({ files, fps, trainIters, removeBackground }, from App) fills
the form in again after a failed or cancelled build. notice is a message
shown in the form's error line, e.g. after a reload stopped an upload.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import { playSound } from '../audio/Audio.js';
import Icon from './Icons.jsx';
import TrainingQualitySlider from './TrainingQualitySlider.jsx';
import { DEFAULT_TRAINING_ITERATIONS } from './TrainingPresets.js';
import { MAX_MEDIA_FILES, MAX_MEDIA_SIZE_MB, MEDIA_ACCEPT, MEDIA_EXT_RE, formatFileSize } from './mediaJobs.js';
import './FrameExtractor.css';

function createMediaItem(file) {
    return {
        id: `${file.name}-${file.lastModified}-${Math.random()}`,
        url: URL.createObjectURL(file),
        file,
        isGif: /\.gif$/i.test(file.name),
    };
}

// Shows a file's opening frame. Not every format plays in a browser (often
// .mkv or .avi), so this falls back to an icon; the server can still read them.
function MediaPreview({ item }) {
    const [hasFailed, setHasFailed] = useState(false);
    if (hasFailed) return <span className="fx-media-fallback"><Icon name="video" size={18} /></span>;
    if (item.isGif) return <img src={item.url} alt="" onError={() => setHasFailed(true)} />;
    return (
        <video
            // #t skips the first instant, which is often a black frame.
            src={`${item.url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            onError={() => setHasFailed(true)}
        />
    );
}

function FrameExtractor({ onStartBuild, initialDraft = null, notice = null }) {
    // Starts from the last build's files and settings, if App passes them back.
    const [mediaItems, setMediaItems] = useState(() => initialDraft?.files.map(createMediaItem) ?? []);
    const [isDragging, setIsDragging] = useState(false);
    const [fps, setFps] = useState(initialDraft?.fps ?? 2);
    // Mask out the background before reconstruction. On by default here, since
    // a video of a turntable otherwise makes the model come out flat or
    // incoherent, and solving the camera positions takes far longer.
    const [removeBackground, setRemoveBackground] = useState(initialDraft?.removeBackground ?? true);
    // Training iteration cap from the "Model detail" slider.
    const [trainIters, setTrainIters] = useState(initialDraft?.trainIters ?? DEFAULT_TRAINING_ITERATIONS);
    const [error, setError] = useState(notice);
    const fileInputRef = useRef(null);
    // Latest file list, read when the page closes to release preview URLs.
    const mediaItemsRef = useRef([]);

    useEffect(() => {
        mediaItemsRef.current = mediaItems;
    }, [mediaItems]);

    // Release the preview URLs when the page closes (App makes its own for
    // the processing screen's preview).
    useEffect(() => {
        return () => {
            mediaItemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
        };
    }, []);

    function addFiles(fileList) {
        const chosenFiles = Array.from(fileList);
        const usableFiles = chosenFiles.filter((file) => MEDIA_EXT_RE.test(file.name));
        const smallEnoughFiles = usableFiles.filter((file) => file.size <= MAX_MEDIA_SIZE_MB * 1024 * 1024);
        const newFiles = smallEnoughFiles.slice(0, MAX_MEDIA_FILES - mediaItems.length);

        if (usableFiles.length < chosenFiles.length) {
            setError('Only videos and animated GIFs can be used here. For photos, use New model.');
        } else if (smallEnoughFiles.length < usableFiles.length) {
            setError(`Each file must be under ${formatFileSize(MAX_MEDIA_SIZE_MB * 1024 * 1024)}.`);
        } else if (newFiles.length < smallEnoughFiles.length) {
            setError(`You can add up to ${MAX_MEDIA_FILES} files at a time.`);
        } else {
            setError(null);
        }
        setMediaItems((prev) => [...prev, ...newFiles.map(createMediaItem)]);
    }

    function removeMediaItem(id) {
        const removedItem = mediaItems.find((item) => item.id === id);
        if (removedItem) URL.revokeObjectURL(removedItem.url);
        setMediaItems((prev) => prev.filter((item) => item.id !== id));
    }

    function handleFileInputChange(e) {
        if (e.target.files) addFiles(e.target.files);
        e.target.value = '';
    }

    function handleDragOver(e) {
        e.preventDefault();
        setIsDragging(true);
    }

    function handleDrop(e) {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    }

    function handleBrowseClick() {
        playSound('tap');
        fileInputRef.current?.click();
    }

    // Lets App upload the files and show the build on the processing screen.
    function handleSubmit(e) {
        e.preventDefault();
        if (mediaItems.length === 0) return;
        playSound('confirm');
        setError(null);
        onStartBuild({
            files: mediaItems.map((item) => item.file),
            fps: Number(fps) || 2,
            trainIters,
            removeBackground,
        });
    }

    return (
        <div className="fx">
            <div className="fx-heading">
                <div>
                    <div className="eyebrow eyebrow-accent">Frame capture</div>
                    <h1 className="fx-title">Frame Extractor</h1>
                    <p className="fx-subtitle">
                        Upload videos that orbit an object. We extract evenly spaced frames and
                        run them through the same reconstruction pipeline, so no live camera
                        capture is needed.
                    </p>
                </div>
            </div>

            <div className="fx-layout">
                <form className="forma-card fx-card fx-source" onSubmit={handleSubmit}>
                    <div
                        className={`fx-dropzone${isDragging ? ' is-dragging' : ''}`}
                        onDragOver={handleDragOver}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={handleBrowseClick}
                    >
                        <span className="fx-dropzone-icon"><Icon name="video" size={30} /></span>
                        <p className="fx-dropzone-title">Drop media files here</p>
                        <p className="fx-dropzone-or">or</p>
                        <button
                            type="button"
                            className="forma-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleBrowseClick();
                            }}
                        >
                            Browse files
                        </button>
                        <span className="fx-dropzone-types">MP4 - MOV - WEBM - MKV - AVI - MPEG - GIF</span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={MEDIA_ACCEPT}
                            multiple
                            onChange={handleFileInputChange}
                            style={{ display: 'none' }}
                            aria-label="Choose media files"
                        />
                    </div>

                    {mediaItems.length > 0 && (
                        <ul className="fx-media-list">
                            {mediaItems.map((item) => (
                                <li key={item.id} className="fx-media-item">
                                    <span className="fx-media-thumb"><MediaPreview item={item} /></span>
                                    <span className="fx-media-name" title={item.file.name}>{item.file.name}</span>
                                    <span className="fx-media-size">{formatFileSize(item.file.size)}</span>
                                    <button
                                        type="button"
                                        className="fx-media-remove"
                                        aria-label={`Remove ${item.file.name}`}
                                        onClick={() => {
                                            playSound('tap');
                                            removeMediaItem(item.id);
                                        }}
                                    >
                                        <Icon name="plus" size={14} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    <div className="fx-row">
                        <label className="fx-fps">
                            <input
                                type="number"
                                min="0.1"
                                max="30"
                                step="0.1"
                                value={fps}
                                onChange={(e) => setFps(e.target.value)}
                                aria-label="Frames per second to extract"
                            />
                            <span>fps</span>
                        </label>
                        <button type="submit" className="forma-btn forma-btn-primary fx-submit" disabled={mediaItems.length === 0}>
                            <Icon name="playSolid" size={14} /> Process media
                        </button>
                    </div>

                    <label className="fx-option">
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
                            <small>Keeps just the object. Turn off to keep the surroundings in the model.</small>
                        </span>
                    </label>

                    <TrainingQualitySlider iterations={trainIters} onChange={setTrainIters} />

                    {error && <p className="fx-error">{error}</p>}

                    <p className="fx-hint">
                        We pull evenly spaced frames from across each whole file, skip blurry and
                        duplicate ones, and feed them straight into the reconstruction pipeline.
                        Higher fps = more frames = slower, more detailed scans.
                    </p>
                </form>
            </div>
        </div>
    );
}

export default FrameExtractor;