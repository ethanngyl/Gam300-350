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
chosen photos are downloaded and handed to onAddFiles as File objects.
Used by both the Photo Editor and Camera Capture.
**************************************************************************/

import { useEffect, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';
import { downloadLibraryPhoto, fetchLibraryBatches } from './LibraryPhotos.js';
import './LibraryPhotoPicker.css';

function photoKey(jobId, imageName) {
    return `${jobId}/${imageName}`;
}

function LibraryPhotoPicker({ onAddFiles, onClose }) {
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

    function togglePhoto(key) {
        setSelectedKeys((currentKeys) => {
            const nextKeys = new Set(currentKeys);
            if (nextKeys.has(key)) {
                nextKeys.delete(key);
            } else {
                nextKeys.add(key);
            }
            return nextKeys;
        });
    }

    function toggleBatch(job) {
        playSound('tap');
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
        playSound('confirm');

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
            setDownloadError("Couldn't download the selected photos. Check that the server is running and try again.");
            return;
        }

        onAddFiles(downloadedFiles);

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
                    <div>
                        <div className="eyebrow eyebrow-accent">Photo library</div>
                        <h2 className="library-picker-title">Choose photos</h2>
                    </div>
                    <button className="forma-btn" onClick={() => { playSound('back'); onClose(); }}>
                        Close
                    </button>
                </div>

                <div className="library-picker-body">
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
                                        const isSelected = selectedKeys.has(key);

                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                className={isSelected ? 'library-picker-photo is-selected' : 'library-picker-photo'}
                                                onClick={() => togglePhoto(key)}
                                                disabled={isDownloading}
                                                aria-pressed={isSelected}
                                                aria-label={image.name}
                                            >
                                                <img src={image.url} alt="" loading="lazy" />
                                                <span className="library-picker-tick">
                                                    {isSelected && <Icon name="check" size={13} />}
                                                </span>
                                            </button>
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
                    <button
                        className="forma-btn forma-btn-primary"
                        onClick={handleAdd}
                        disabled={selectedCount === 0 || isDownloading}
                    >
                        <Icon name="plus" size={14} /> Add {selectedCount > 0 ? selectedCount : ''} photo{selectedCount === 1 ? '' : 's'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default LibraryPhotoPicker;