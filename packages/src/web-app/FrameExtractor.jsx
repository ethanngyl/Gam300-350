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
onStartBuild({ files, fps, trainIters, removeBackground, autoCrop }). App
uploads and builds it in the background, shown in the build panel
(useBackgroundBuilds.js), like a photo build. The file rules and the upload
live in mediaJobs.js. There is no Back button; the sidebar handles navigation.
Phones get JM's mobile layout instead (reached by picking a video with
Capture's gallery button; the top bar's Back to home leaves): a card per
video with its preview (tap to play), name, length, resolution and size;
an "Extract settings" card with an FPS stepper and how many frames that
gives, the two options and Model detail ("How does this work?" opens the
note on how frames are picked); and "Extract frames" along the bottom.
Everything the wider layout does is there: more videos can be added and
any removed.
- FrameExtractor({ onStartBuild, initialDraft })
initialDraft ({ files, fps, trainIters, removeBackground, autoCrop }, from App) fills
the form in again after a failed build.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import TrainingQualitySlider from './TrainingQualitySlider.jsx';
import { DEFAULT_TRAINING_ITERATIONS } from './TrainingPresets.js';
import { MAX_MEDIA_FILES, MAX_MEDIA_SIZE_MB, MEDIA_ACCEPT, MEDIA_EXT_RE, formatFileSize } from './mediaJobs.js';
import { useMobileView } from './useMobileView.js';
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

// The phone FPS stepper's range (any rate can still be typed in the box).
const MIN_STEPPER_FPS = 1;
const MAX_FPS = 30;

// "0:24" from a length in seconds.
function formatDuration(seconds) {
    const wholeSeconds = Math.round(seconds);
    return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

// Phones: one video's card. Its preview plays when tapped, and its length and
// resolution are read from the file once the browser has loaded them
// (onInfo gets { duration, width, height }). Formats the browser can't play
// show an icon and just the name and size.
function PhoneMediaCard({ item, info, onInfo, onRemove }) {
    const videoRef = useRef(null);
    const [hasFailed, setHasFailed] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);

    function playVideo() {
        setIsPlaying(true);
        videoRef.current?.play().catch(() => setIsPlaying(false));
    }

    const details = [
        info?.duration ? formatDuration(info.duration) : null,
        info?.height ? `${Math.min(info.width, info.height)}p` : null,
        formatFileSize(item.file.size),
    ].filter(Boolean);

    let preview;
    if (hasFailed) {
        preview = <span className="fx-media-fallback"><Icon name="video" size={28} /></span>;
    } else if (item.isGif) {
        preview = <img src={item.url} alt="" onError={() => setHasFailed(true)} />;
    } else {
        preview = (
            <>
                <video
                    ref={videoRef}
                    src={`${item.url}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    controls={isPlaying}
                    onLoadedMetadata={(e) => {
                        const video = e.currentTarget;
                        onInfo({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
                    }}
                    onError={() => setHasFailed(true)}
                />
                {!isPlaying && (
                    <button type="button" className="fx-phone-play" aria-label={`Play ${item.file.name}`} onClick={playVideo}>
                        <Icon name="playSolid" size={18} />
                    </button>
                )}
                {!isPlaying && info?.duration > 0 && (
                    <span className="fx-phone-duration">{formatDuration(info.duration)}</span>
                )}
            </>
        );
    }

    return (
        <li className="forma-card fx-phone-card fx-phone-media">
            <div className="fx-phone-preview">{preview}</div>
            <div className="fx-phone-media-text">
                <span>
                    <strong title={item.file.name}>{item.file.name}</strong>
                    <small>{details.join(' \u00b7 ')}</small>
                </span>
                <button type="button" className="fx-phone-remove" aria-label={`Remove ${item.file.name}`} onClick={onRemove}>
                    <Icon name="close" size={16} />
                </button>
            </div>
        </li>
    );
}

function FrameExtractor({ onStartBuild, initialDraft = null }) {
    const isPhone = useMobileView();
    // Starts from the last build's files and settings, if App passes them back.
    const [mediaItems, setMediaItems] = useState(() => initialDraft?.files.map(createMediaItem) ?? []);
    const [isDragging, setIsDragging] = useState(false);
    const [fps, setFps] = useState(initialDraft?.fps ?? 2);
    // Mask out the background before reconstruction. On by default here, since
    // a video of a turntable otherwise makes the model come out flat or
    // incoherent, and solving the camera positions takes far longer.
    const [removeBackground, setRemoveBackground] = useState(initialDraft?.removeBackground ?? true);
    // Keep only the object the video was filmed around (walk-around videos).
    const [autoCrop, setAutoCrop] = useState(initialDraft?.autoCrop ?? false);
    // Training iteration cap from the "Model detail" slider.
    const [trainIters, setTrainIters] = useState(initialDraft?.trainIters ?? DEFAULT_TRAINING_ITERATIONS);
    const [error, setError] = useState(null);
    // Phones: each video's length and resolution, by item id.
    const [mediaInfo, setMediaInfo] = useState({});
    // Phones: whether the note under Model detail is open.
    const [isHelpOpen, setIsHelpOpen] = useState(false);
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
        fileInputRef.current?.click();
    }

    // Lets App upload the files and show the build on the processing screen.
    function handleSubmit(e) {
        e.preventDefault();
        if (mediaItems.length === 0) return;
        setError(null);
        onStartBuild({
            files: mediaItems.map((item) => item.file),
            fps: Number(fps) || 2,
            trainIters,
            removeBackground,
            autoCrop,
        });
    }

    const fileInput = (
        <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
            aria-label="Choose media files"
        />
    );

    if (isPhone) {
        // Frames from every video at this rate, once their lengths are known.
        const fpsNumber = Number(fps) || 0;
        const totalSeconds = mediaItems.reduce((sum, item) => sum + (mediaInfo[item.id]?.duration || 0), 0);
        const hasAllLengths = mediaItems.length > 0 && mediaItems.every((item) => mediaInfo[item.id]?.duration > 0);

        return (
            <form className="fx fx-phone" onSubmit={handleSubmit}>
                <h1 className="page-title">Video Extractor</h1>

                {mediaItems.length > 0 && (
                    <ul className="fx-phone-media-list">
                        {mediaItems.map((item) => (
                            <PhoneMediaCard
                                key={item.id}
                                item={item}
                                info={mediaInfo[item.id]}
                                onInfo={(info) => setMediaInfo((prev) => ({ ...prev, [item.id]: info }))}
                                onRemove={() => {
                                    removeMediaItem(item.id);
                                }}
                            />
                        ))}
                    </ul>
                )}

                {mediaItems.length < MAX_MEDIA_FILES && (
                    <button type="button" className="forma-btn fx-phone-add" onClick={handleBrowseClick}>
                        <Icon name={mediaItems.length === 0 ? 'video' : 'plus'} size={16} />
                        {mediaItems.length === 0 ? 'Choose a video' : 'Add another video'}
                    </button>
                )}
                {fileInput}

                {error && <p className="fx-error">{error}</p>}

                <div className="forma-card fx-phone-card fx-phone-settings">
                    <h2>Extract settings</h2>
                    <div className="fx-phone-fps-row">
                        <label className="fx-phone-stepper">
                            <input
                                type="number"
                                min="0.1"
                                max={MAX_FPS}
                                step="0.1"
                                value={fps}
                                onChange={(e) => setFps(e.target.value)}
                                aria-label="Frames per second to extract"
                            />
                            <span className="fx-phone-stepper-buttons">
                                <button
                                    type="button"
                                    aria-label="More frames per second"
                                    disabled={fpsNumber >= MAX_FPS}
                                    onClick={() => setFps(Math.min(MAX_FPS, Math.floor(fpsNumber) + 1))}
                                >
                                    <Icon name="chevron" size={12} />
                                </button>
                                <button
                                    type="button"
                                    aria-label="Fewer frames per second"
                                    disabled={fpsNumber <= MIN_STEPPER_FPS}
                                    onClick={() => setFps(Math.max(MIN_STEPPER_FPS, Math.ceil(fpsNumber) - 1))}
                                >
                                    <Icon name="chevron" size={12} />
                                </button>
                            </span>
                            <span className="fx-phone-stepper-unit">FPS</span>
                        </label>
                        {hasAllLengths && fpsNumber > 0 && (
                            <span className="fx-phone-estimate">
                                {'\u2248'} {Math.round(totalSeconds * fpsNumber)} frames from {formatDuration(totalSeconds)}
                            </span>
                        )}
                    </div>

                    <label className="fx-phone-option">
                        <span>
                            Remove background
                            <small>Keeps just the object. Turn off to keep the surroundings in the model.</small>
                        </span>
                        <input
                            type="checkbox"
                            className="forma-switch"
                            checked={removeBackground}
                            onChange={(e) => {
                                setRemoveBackground(e.target.checked);
                            }}
                        />
                    </label>
                    <label className="fx-phone-option">
                        <span>
                            Keep only the main object
                            <small>For walkarounds: removes everything outside the path the camera took.</small>
                        </span>
                        <input
                            type="checkbox"
                            className="forma-switch"
                            checked={autoCrop}
                            onChange={(e) => {
                                setAutoCrop(e.target.checked);
                            }}
                        />
                    </label>

                    <div className="fx-phone-quality">
                        <TrainingQualitySlider iterations={trainIters} onChange={setTrainIters} />
                        <button
                            type="button"
                            className="fx-phone-help"
                            aria-expanded={isHelpOpen}
                            onClick={() => {
                                setIsHelpOpen((isOpen) => !isOpen);
                            }}
                        >
                            How does this work?
                        </button>
                    </div>
                    {isHelpOpen && (
                        <p className="fx-hint">
                            We pull evenly spaced frames from across each whole video, skip blurry and
                            duplicate ones, and build the model from them. More FPS means more frames:
                            slower, but more detailed. More model detail trains for longer.
                        </p>
                    )}
                </div>

                <div className="fx-phone-footer">
                    <button type="submit" className="forma-btn forma-btn-primary" disabled={mediaItems.length === 0}>
                        <Icon name="sparkle" size={16} /> Extract frames
                    </button>
                </div>
            </form>
        );
    }

    return (
        <div className="fx">
            <div className="fx-heading">
                <div>
                    <div className="eyebrow eyebrow-accent">Frame capture</div>
                    <h1 className="fx-title">Video Extractor</h1>
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
                        {fileInput}
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
                                setRemoveBackground(e.target.checked);
                            }}
                        />
                        <span>
                            Remove background
                            <small>Keeps just the object. Turn off to keep the surroundings in the model.</small>
                        </span>
                    </label>

                    <label className="fx-option">
                        <input
                            type="checkbox"
                            checked={autoCrop}
                            onChange={(e) => {
                                setAutoCrop(e.target.checked);
                            }}
                        />
                        <span>
                            Keep only the main object
                            <small>When the video walks around an object, removes everything outside the path it took. Turn off for rooms and scenery.</small>
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