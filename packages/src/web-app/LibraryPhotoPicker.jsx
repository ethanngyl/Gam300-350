/*!************************************************************************
\file LibraryPhotoPicker.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 20-10-2026
\brief
Pop-up for choosing photos from the library (past jobs). Lists each batch
with its photos; the user ticks single photos or whole batches, then the
chosen photos are downloaded and handed to onAddFiles(files, { failedCount })
as File objects; failedCount says how many couldn't be downloaded (the
picker then stays open to say so).
When they have all downloaded the tick sound plays (the error sound if
any couldn't be).
Used by the Photo Editor, Camera Capture and the New model dialog. Laid
out like the Figma's "Add photos from library": a title with an X, each
photo with its file name, then Cancel and "Add selected photos".
A large library holds thousands of photos, so each tile (PhotoTile) shows its
picture only while it is near the visible part of the list (one
IntersectionObserver, PHOTO_LOAD_MARGIN), and drops it once scrolled well
past; it comes back from the browser cache when scrolled to again.
**************************************************************************/

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { downloadLibraryPhoto, fetchLibraryBatches, smallPhotoUrl } from './LibraryPhotos.js';
import { playSound } from '../audio/Audio.js';
import './LibraryPhotoPicker.css';

// How far outside the visible part of the list a photo is still kept loaded:
// about two rows, so scrolling at a normal pace never shows empty tiles.
const PHOTO_LOAD_MARGIN = '300px 0px';

function photoKey(jobId, imageName) {
    return `${jobId}/${imageName}`;
}

// One photo of a batch. Its picture is only in the page while the tile is
// near the visible part of the list (observe); scrolled well past, the <img>
// is removed so the browser can free the decoded picture, and it comes back
// (from the browser cache) when the tile scrolls into view again. memo: picking
// a photo redraws that tile only, not every photo in the library.
const PhotoTile = memo(function PhotoTile({ itemKey, image, isSelected, disabled, onToggle, observe }) {
    const frameRef = useRef(null);
    const [isNearView, setIsNearView] = useState(false);

    useEffect(() => observe(frameRef.current, setIsNearView), [observe]);

    return (
        <button
            type="button"
            className={isSelected ? 'library-picker-photo is-selected' : 'library-picker-photo'}
            onClick={() => onToggle(itemKey)}
            disabled={disabled}
            aria-pressed={isSelected}
            aria-label={image.name}
        >
            <span className="library-picker-photo-frame" ref={frameRef}>
                {isNearView && <img src={smallPhotoUrl(image.url)} alt="" decoding="async" />}
                <span className="library-picker-tick">
                    {isSelected && <Icon name="check" size={13} />}
                </span>
            </span>
            <span className="library-picker-photo-name">{image.name}</span>
        </button>
    );
});

function LibraryPhotoPicker({ onAddFiles, onClose }) {
    // The scrolling list, and one IntersectionObserver for every photo tile in it.
    const bodyRef = useRef(null);
    const observerRef = useRef(null);
    const visibilityCallbacksRef = useRef(new Map()); // tile element -> setIsNearView

    // Calls onChange(true / false) as element comes near / goes out of view;
    // returns the function that stops watching it. Made on first use: the
    // tiles' effects run before this component's, but bodyRef is already set.
    const observe = useCallback((element, onChange) => {
        if (!element) return undefined;
        if (!observerRef.current) {
            if (typeof IntersectionObserver === 'undefined') {
                onChange(true); // very old browser: just show every photo
                return undefined;
            }
            observerRef.current = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    visibilityCallbacksRef.current.get(entry.target)?.(entry.isIntersecting);
                });
            }, { root: bodyRef.current, rootMargin: PHOTO_LOAD_MARGIN });
        }
        visibilityCallbacksRef.current.set(element, onChange);
        observerRef.current.observe(element);
        return () => {
            visibilityCallbacksRef.current.delete(element);
            observerRef.current?.unobserve(element);
        };
    }, []);

    useEffect(() => () => {
        observerRef.current?.disconnect();
        observerRef.current = null;
    }, []);

    const [batches, setBatches] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [selectedKeys, setSelectedKeys] = useState(() => new Set());
    // How many photos have been downloaded so far; null when not downloading.
    const [downloadedCount, setDownloadedCount] = useState(null);
    const [downloadError, setDownloadError] = useState(null);

    useEffect(() => {
        let isCancelled = false;

        fetchLibraryBatches()
            .then((libraryBatches) => {
                if (!isCancelled) setBatches(libraryBatches);
            })
            .catch((err) => {
                if (!isCancelled) setLoadError(err.message);
            })
            .finally(() => {
                if (!isCancelled) setIsLoading(false);
            });

        return () => { isCancelled = true; };
    }, []);

    // Escape closes the picker.
    useEffect(() => {
        function closeOnEscape(event) {
            if (event.key === 'Escape') onClose();
        }
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [onClose]);

    const isDownloading = downloadedCount !== null;
    const selectedCount = selectedKeys.size;

    // useCallback: the same function every render, so PhotoTile's memo holds.
    const togglePhoto = useCallback((key) => {
        setSelectedKeys((currentKeys) => {
            const nextKeys = new Set(currentKeys);
            if (nextKeys.has(key)) {
                nextKeys.delete(key);
            } else {
                nextKeys.add(key);
            }
            return nextKeys;
        });
    }, []);

    function toggleBatch(job) {
        const batchKeys = job.images.map((image) => photoKey(job.id, image.name));
        const isWholeBatchSelected = batchKeys.every((key) => selectedKeys.has(key));
        setSelectedKeys((currentKeys) => {
            const nextKeys = new Set(currentKeys);
            batchKeys.forEach((key) => {
                if (isWholeBatchSelected) {
                    nextKeys.delete(key);
                } else {
                    nextKeys.add(key);
                }
            });
            return nextKeys;
        });
    }

    async function handleAdd() {

        const chosenPhotos = [];
        batches.forEach((job) => {
            job.images.forEach((image) => {
                if (selectedKeys.has(photoKey(job.id, image.name))) {
                    chosenPhotos.push({ jobId: job.id, image });
                }
            });
        });

        setDownloadError(null);
        setDownloadedCount(0);

        const downloadedFiles = [];
        let failedCount = 0;
        for (const { jobId, image } of chosenPhotos) {
            try {
                downloadedFiles.push(await downloadLibraryPhoto(jobId, image));
            } catch {
                failedCount++;
            }
            setDownloadedCount(downloadedFiles.length + failedCount);
        }

        setDownloadedCount(null);

        if (downloadedFiles.length === 0) {
            playSound('error');
            setDownloadError("Couldn't download the selected photos. Check that the server is running and try again.");
            return;
        }

        playSound(failedCount > 0 ? 'error' : 'tick');
        onAddFiles(downloadedFiles, { failedCount });

        if (failedCount > 0) {
            // Keep the picker open so the user sees that some photos are missing.
            setSelectedKeys(new Set());
            setDownloadError(`${failedCount} photo${failedCount === 1 ? '' : 's'} couldn't be downloaded. The rest were added.`);
            return;
        }

        onClose();
    }

    return (
        <div className="library-picker">
            <button
                type="button"
                className="library-picker-backdrop"
                aria-label="Close"
                onClick={onClose}
            />

            <div className="library-picker-dialog" role="dialog" aria-modal="true" aria-label="Choose photos from library">
                <div className="library-picker-header">
                    <h2 className="library-picker-title">Add photos from library</h2>
                    <button
                        type="button"
                        className="library-picker-close"
                        aria-label="Close"
                        onClick={() => { onClose(); }}
                    >
                        <Icon name="close" size={16} />
                    </button>
                </div>

                <div className="library-picker-body" ref={bodyRef}>
                    {isLoading && <p className="library-picker-note">Loading...</p>}
                    {loadError && (
                        <p className="library-picker-note library-picker-error">Couldn't load the library: {loadError}</p>
                    )}
                    {!isLoading && !loadError && batches.length === 0 && (
                        <p className="library-picker-note">No photos in the library yet.</p>
                    )}

                    {batches.map((job) => {
                        const isWholeBatchSelected = job.images.every((image) =>
                            selectedKeys.has(photoKey(job.id, image.name))
                        );

                        return (
                            <section key={job.id} className="library-picker-batch">
                                <div className="library-picker-batch-head">
                                    <span className="library-picker-batch-name">Batch {job.id.slice(0, 8)}</span>
                                    <span className="library-picker-batch-meta">
                                        {job.status} - {job.images.length} photos
                                    </span>
                                    <button
                                        type="button"
                                        className="library-picker-select-all"
                                        onClick={() => toggleBatch(job)}
                                        disabled={isDownloading}
                                    >
                                        {isWholeBatchSelected ? 'Clear' : 'Select all'}
                                    </button>
                                </div>

                                <div className="library-picker-grid">
                                    {job.images.map((image) => {
                                        const key = photoKey(job.id, image.name);
                                        return (
                                            <PhotoTile
                                                key={key}
                                                itemKey={key}
                                                image={image}
                                                isSelected={selectedKeys.has(key)}
                                                disabled={isDownloading}
                                                onToggle={togglePhoto}
                                                observe={observe}
                                            />
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })}
                </div>

                <div className="library-picker-footer">
                    <span className="library-picker-footer-text">
                        {downloadError ? (
                            <span className="library-picker-error" role="alert">{downloadError}</span>
                        ) : isDownloading ? (
                            `Downloading ${downloadedCount}/${selectedCount}...`
                        ) : (
                            `${selectedCount} selected`
                        )}
                    </span>
                    <button type="button" className="forma-btn" onClick={() => { onClose(); }}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="forma-btn forma-btn-primary"
                        onClick={handleAdd}
                        disabled={selectedCount === 0 || isDownloading}
                    >
                        <Icon name="plus" size={14} /> Add selected photos
                    </button>
                </div>
            </div>
        </div>
    );
}

export default LibraryPhotoPicker;  