/*!************************************************************************
\file YoutubeIngest.jsx
\author1 Ethan Ng Yong Le
\author2 Bryan Lim Jun Jie
\par DP email1: n.ethanyongle@digipen.edu
\par DP email2: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Video Extractor page. Lets the user choose a YouTube video link or an .mp4
file (a "YouTube link | Video file" switch), the frame-extraction rate and
the model detail (training iteration cap, via TrainingQualitySlider). The
link or file, fps and "Process video" share one box; under it, a dashed
preview box shows the video's thumbnail (or the chosen file, played from
the browser) once it is valid (before that, how to start), with a note on
how frames are picked.
"Process video" checks the input, then hands it to App through
onStartBuild({ sourceType, url, file, fps, trainIters }). App opens the
full-screen processing screen (Processing.jsx), the same one photo builds
use, which uploads the video if needed and shows the build's progress. The
link / file helpers live in videoJobs.js. There is no Back button; the
dock handles navigation.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import { playSound } from '../audio/Audio.js';
import Icon from './Icons.jsx';
import TrainingQualitySlider from './TrainingQualitySlider.jsx';
import { DEFAULT_TRAINING_ITERATIONS } from './TrainingPresets.js';
import {
    MAX_VIDEO_MB,
    formatFileSize,
    normalizeYoutubeUrl,
    videoFileProblem,
    youtubeThumbnailUrl,
    youtubeVideoId,
} from './VideoJobs.js';
import './YoutubeIngest.css';

function YoutubeIngest({ onStartBuild }) {
    // 'youtube' (a link) or 'file' (an .mp4 from this device).
    const [sourceType, setSourceType] = useState('youtube');
    const [url, setUrl] = useState('');
    const [videoFile, setVideoFile] = useState(null);
    // Local preview of the chosen file (an object URL; nothing is uploaded).
    const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
    const [fps, setFps] = useState(2);
    // Training iteration cap from the "Model detail" slider.
    const [trainIters, setTrainIters] = useState(DEFAULT_TRAINING_ITERATIONS);
    const [error, setError] = useState(null);
    const [hasThumbnailFailed, setHasThumbnailFailed] = useState(false);

    // Frees the chosen file's preview URL when leaving the page.
    const previewUrlRef = useRef(null);
    useEffect(() => () => {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    }, []);

    // Picks a new video file (or none) and swaps its preview URL.
    function chooseVideoFile(file) {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = file ? URL.createObjectURL(file) : null;
        setVideoFile(file);
        setVideoPreviewUrl(previewUrlRef.current);
        setError(file ? videoFileProblem(file) : null);
    }

    // Checks the link or file, then lets App start the build.
    function handleSubmit(e) {
        e.preventDefault();
        setError(null);

        if (sourceType === 'file') {
            const problem = videoFileProblem(videoFile);
            if (problem) {
                playSound('error');
                setError(problem);
                return;
            }
            playSound('confirm');
            onStartBuild({ sourceType: 'file', file: videoFile, fps, trainIters });
            return;
        }

        const trimmed = normalizeYoutubeUrl(url.trim());
        if (!trimmed) {
            playSound('error');
            setError('Please enter a link to a single YouTube video (not a playlist or channel).');
            return;
        }
        playSound('confirm');
        onStartBuild({ sourceType: 'youtube', url: trimmed, fps, trainIters });
    }

    const isFileSource = sourceType === 'file';
    const videoId = isFileSource ? null : youtubeVideoId(url.trim());
    const canSubmit = isFileSource ? Boolean(videoFile) : Boolean(url.trim());

    return (
        <div className="yt">
            <div className="yt-heading">
                <div>
                    <div className="eyebrow eyebrow-accent">Frame capture</div>
                    <h1 className="yt-title">Video Extractor</h1>
                    <p className="yt-subtitle">
                        Paste a YouTube link or upload an .mp4 of a video that orbits an object.
                        We extract evenly spaced frames and run them through the same
                        reconstruction pipeline, so no phone capture is needed.
                    </p>
                </div>
            </div>

            <div className="yt-layout">
                <form className="forma-card yt-card yt-source" onSubmit={handleSubmit}>
                    <div className="yt-mode" role="group" aria-label="Video source">
                        <button
                            type="button"
                            className={`yt-mode-btn${isFileSource ? '' : ' is-active'}`}
                            aria-pressed={!isFileSource}
                            onClick={() => {
                                playSound('tap');
                                setSourceType('youtube');
                                setError(null);
                            }}
                        >
                            <Icon name="link" size={14} /> YouTube link
                        </button>
                        <button
                            type="button"
                            className={`yt-mode-btn${isFileSource ? ' is-active' : ''}`}
                            aria-pressed={isFileSource}
                            onClick={() => {
                                playSound('tap');
                                setSourceType('file');
                                setError(null);
                            }}
                        >
                            <Icon name="upload" size={14} /> Video file
                        </button>
                    </div>

                    <label className="eyebrow yt-source-label" htmlFor={isFileSource ? 'yt-file' : 'yt-url'}>
                        {isFileSource ? 'Video file (.mp4)' : 'Video URL'}
                    </label>
                    <div className="yt-row">
                        {isFileSource ? (
                            <label className="yt-input-wrap yt-file">
                                <Icon name="upload" size={16} />
                                <span className={`yt-input yt-file-name${videoFile ? '' : ' is-empty'}`}>
                                    {videoFile
                                        ? `${videoFile.name} (${formatFileSize(videoFile.size)})`
                                        : 'Choose an .mp4 video...'}
                                </span>
                                <input
                                    id="yt-file"
                                    type="file"
                                    className="yt-file-input"
                                    accept="video/mp4,.mp4"
                                    onChange={(e) => chooseVideoFile(e.target.files?.[0] ?? null)}
                                />
                            </label>
                        ) : (
                            <div className="yt-input-wrap">
                                <Icon name="link" size={16} />
                                <input
                                    id="yt-url"
                                    type="url"
                                    className="yt-input"
                                    placeholder="https://youtube.com/watch?v=..."
                                    value={url}
                                    onChange={(e) => {
                                        setUrl(e.target.value);
                                        setHasThumbnailFailed(false);
                                    }}
                                />
                            </div>
                        )}
                        <label className="yt-fps">
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
                        <button type="submit" className="forma-btn forma-btn-primary yt-submit" disabled={!canSubmit}>
                            <Icon name="playSolid" size={14} /> Process video
                        </button>
                    </div>

                    <TrainingQualitySlider iterations={trainIters} onChange={setTrainIters} />

                    {error && <p className="yt-error">{error}</p>}
                </form>

                {/* Shows the video's thumbnail once the link is valid (or the chosen
                    file, played from this device), else how to start. */}
                <div className="yt-preview-box">
                    {isFileSource && videoPreviewUrl ? (
                        <div className="yt-preview">
                            <video src={videoPreviewUrl} muted controls preload="metadata" aria-label="Preview of the chosen video" />
                        </div>
                    ) : videoId && !hasThumbnailFailed ? (
                        <div className="yt-preview">
                            <img
                                src={youtubeThumbnailUrl(videoId)}
                                alt="Thumbnail of the linked video"
                                onError={() => setHasThumbnailFailed(true)}
                            />
                        </div>
                    ) : isFileSource ? (
                        <>
                            <span className="yt-preview-icon"><Icon name="upload" size={34} /></span>
                            <p className="yt-preview-title">Choose an .mp4 video above and click Process video</p>
                            <p className="yt-preview-formats">.mp4 files up to {MAX_VIDEO_MB} MB</p>
                        </>
                    ) : (
                        <>
                            <span className="yt-preview-icon"><Icon name="video" size={34} /></span>
                            <p className="yt-preview-title">Enter a YouTube URL above and click Process video</p>
                            <p className="yt-preview-formats">Supports youtube.com/watch and youtu.be short links</p>
                        </>
                    )}
                    <p className="yt-hint">
                        We pull evenly spaced frames from across the whole video (up to 20 minutes),
                        skip blurry and duplicate ones, and feed them straight into the reconstruction
                        pipeline. Higher fps = more frames = slower, more detailed scans.
                        {isFileSource && ' The video is deleted from the server as soon as its frames are extracted; only the frames are kept.'}
                    </p>
                </div>
            </div>
        </div>
    );
}

export default YoutubeIngest;