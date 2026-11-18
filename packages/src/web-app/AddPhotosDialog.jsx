/*!************************************************************************
\file AddPhotosDialog.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
"Add source photos" dialog, opened from Home's Add photos card, laid out
like the Genesis Figma: a drop area with Browse files, then Cancel and
"Continue to Photo Editor". Photos can be dropped or chosen several times;
the chosen ones show as a row of small previews with a count. Escape, the
X, Cancel and a click outside close it.
- AddPhotosDialog({ onContinue, onClose })
React component. onContinue(files) gets the chosen photos.
**************************************************************************/

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';
import './AddPhotosDialog.css';

// How many chosen photos show as previews before "+N".
const PREVIEW_COUNT = 8;

function isImageFile(file) {
    return file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(file.name);
}

function AddPhotosDialog({ onContinue, onClose }) {
    const [chosenFiles, setChosenFiles] = useState([]);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef(null);
    // Object URLs for the previews, freed when the photos change or on close.
    const previewUrls = useMemo(
        () => chosenFiles.slice(0, PREVIEW_COUNT).map((file) => URL.createObjectURL(file)),
        [chosenFiles],
    );

    useEffect(() => {
        function closeOnEscape(event) {
            if (event.key === 'Escape') onClose();
        }
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [onClose]);

    useEffect(() => () => previewUrls.forEach((url) => URL.revokeObjectURL(url)), [previewUrls]);

    function addFiles(fileList) {
        const images = Array.from(fileList ?? []).filter(isImageFile);
        if (images.length === 0) return;
        playSound('tap');
        setChosenFiles((current) => [...current, ...images]);
    }

    function handleFileInputChange(event) {
        addFiles(event.target.files);
        // Clear so choosing the same photos again still fires onChange.
        event.target.value = '';
    }

    function handleDrop(event) {
        event.preventDefault();
        setIsDragging(false);
        addFiles(event.dataTransfer.files);
    }

    return (
        <div className="add-photos-backdrop" onClick={onClose}>
            <div
                className="add-photos-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Add source photos"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="add-photos-head">
                    <h2>Add source photos</h2>
                    <button type="button" className="add-photos-close" onClick={onClose} aria-label="Close">
                        <Icon name="close" size={16} />
                    </button>
                </div>

                <div className="add-photos-body">
                    <div
                        className={isDragging ? 'add-photos-drop is-dragging' : 'add-photos-drop'}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                    >
                        <span className="add-photos-drop-icon"><Icon name="upload" size={22} /></span>
                        <strong>Choose photos to upload</strong>
                        <p>Drag and drop files here, or browse from your device.</p>
                        <button
                            type="button"
                            className="forma-btn"
                            onClick={() => {
                                playSound('tap');
                                fileInputRef.current?.click();
                            }}
                        >
                            <Icon name="folder" size={15} /> Browse files
                        </button>
                        <small>JPG, PNG, WEBP and HEIC {'\u00b7'} 40{'\u2013'}80 overlapping shots work best</small>
                        <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFileInputChange} />
                    </div>

                    {chosenFiles.length > 0 && (
                        <div className="add-photos-chosen">
                            <span>{chosenFiles.length} photo{chosenFiles.length === 1 ? '' : 's'} chosen</span>
                            <div className="add-photos-previews">
                                {previewUrls.map((url) => <img key={url} src={url} alt="" />)}
                                {chosenFiles.length > PREVIEW_COUNT && (
                                    <span className="add-photos-more">+{chosenFiles.length - PREVIEW_COUNT}</span>
                                )}
                            </div>
                            <button
                                type="button"
                                className="add-photos-clear"
                                onClick={() => {
                                    playSound('back');
                                    setChosenFiles([]);
                                }}
                            >
                                Clear
                            </button>
                        </div>
                    )}
                </div>

                <div className="add-photos-footer">
                    <button type="button" className="forma-btn" onClick={onClose}>Cancel</button>
                    <button
                        type="button"
                        className="forma-btn forma-btn-primary"
                        disabled={chosenFiles.length === 0}
                        onClick={() => {
                            playSound('confirm');
                            onContinue(chosenFiles);
                        }}
                    >
                        Continue to Photo Editor
                    </button>
                </div>
            </div>
        </div>
    );
}

export default AddPhotosDialog;