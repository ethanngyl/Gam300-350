/*!************************************************************************
\file ModelScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Page for one 3D model, shown inside the dashboard (the dock stays) when a
model is opened from Home, the Media Library or the Model Viewer, and when
a build finishes. Top: a back link to where it was opened from, the
model's name (pencil to rename), a Ready badge, when it was made and how
many photos it used, then Download .ply and Add to scene. Below, the 3D
viewer fills a large card (SplatViewer, embedded, with its renderer and
view controls, plus a full-screen button); beside it on wider screens, and
under it on phones: Details (photos, background removal, splat count, file
size), Source photos (with "Open in Media Library") and Manage (Rename,
Delete). Rename and delete use the Library's dialog and calls (mediaApi).
A .ply opened from the user's computer uses the same page with only the
viewer and its file details.
Right after a build, showNamePrompt asks for the model's name first.
- ModelScreen({ jobId, localFile, backLabel, showNamePrompt, onNamePromptClose,
  onBack, onOpenPhotos, onAddToScene, onDeleted })
React component. jobId for a server model, or localFile ({ url, name,
sizeBytes }) for a .ply from the user's computer.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import ActionDialog from './ActionDialog.jsx';
import Icon from './Icons.jsx';
import NameModelPrompt from './NameModelPrompt.jsx';
import SplatViewer from './SplatViewer.jsx';
import { deleteJob, jobDisplayName, renameJob } from './mediaApi.js';
import { readPlyInfo } from './plyHeader.js';
import { playSound } from '../audio/Audio.js';
import './ModelScreen.css';

// How many source photos the side card shows before "+N".
const PHOTO_PREVIEW_COUNT = 7;

// "2 Nov 2026, 9:41 pm"
function formatCreatedDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('en-SG', {
        day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
}

// "71.9 MB"
function formatFileSize(bytes) {
    if (!bytes) return null;
    return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function ModelScreen({
    jobId,
    localFile,
    backLabel,
    showNamePrompt,
    onNamePromptClose,
    onBack,
    onOpenPhotos,
    onAddToScene,
    onDeleted,
}) {
    // The job from GET /jobs (name, createdAt, images ...), null until loaded.
    const [model, setModel] = useState(null);
    const [loadError, setLoadError] = useState(null);
    // From the .ply header: { splatCount, fileSizeBytes }.
    const [plyInfo, setPlyInfo] = useState(null);
    // Rename / delete dialog (ActionDialog props), or null.
    const [dialog, setDialog] = useState(null);
    // Bumped to load the model again (after naming it).
    const [reloadCount, setReloadCount] = useState(0);
    const viewerCardRef = useRef(null);

    const plyUrl = jobId ? `/jobs/${jobId}/result.ply` : localFile?.url;
    const modelName = jobId
        ? (model ? jobDisplayName(model, 'Model') : 'Loading...')
        : localFile?.name;

    useEffect(() => {
        if (!jobId) return;
        let isCancelled = false;

        async function loadModel() {
            try {
                const res = await fetch('/jobs');
                if (!res.ok) throw new Error(`Server returned ${res.status}`);
                const allJobs = await res.json();
                const thisJob = Array.isArray(allJobs) ? allJobs.find((listedJob) => listedJob.id === jobId) : null;
                if (!thisJob) throw new Error('This model no longer exists.');
                // /jobs has no removeBackground; /jobs/:id does.
                const detailRes = await fetch(`/jobs/${jobId}`);
                const detail = detailRes.ok ? await detailRes.json() : {};
                if (isCancelled) return;
                setModel({ ...thisJob, removeBackground: detail.removeBackground ?? null });
                setLoadError(null);
            } catch (err) {
                if (!isCancelled) setLoadError(err.message);
            }
        }

        loadModel();
        return () => {
            isCancelled = true;
        };
    }, [jobId, reloadCount]);

    // Splat count and file size, read from the .ply's first 4 KB.
    useEffect(() => {
        if (!plyUrl) return;
        let isCancelled = false;
        readPlyInfo(plyUrl).then((info) => {
            if (!isCancelled) setPlyInfo(info);
        });
        return () => {
            isCancelled = true;
        };
    }, [plyUrl]);

    function openRenameDialog() {
        playSound('tap');
        setDialog({
            title: 'Rename model',
            message: 'Also renames its .ply in the engine samples folder (spaces become _). '
                + 'Leave empty to use the default name.',
            initialValue: model?.name ?? '',
            confirmLabel: 'Rename',
            onConfirm: async (name) => {
                const result = await renameJob(jobId, name);
                setModel((current) => current && { ...current, name: result.name });
                setDialog(null);
            },
        });
    }

    function openDeleteDialog() {
        playSound('tap');
        const photoCount = model?.imageCount ?? model?.images?.length ?? 0;
        setDialog({
            title: `Delete ${modelName}?`,
            message: `This permanently deletes the model and its ${photoCount} source photo${photoCount === 1 ? '' : 's'}.`,
            confirmLabel: 'Delete',
            danger: true,
            onConfirm: async () => {
                await deleteJob(jobId);
                setDialog(null);
                onDeleted();
            },
        });
    }

    function toggleFullScreen() {
        playSound('tap');
        if (document.fullscreenElement) document.exitFullscreen?.();
        else viewerCardRef.current?.requestFullscreen?.();
    }

    const photos = model?.images ?? [];
    const photoCount = model?.imageCount ?? (photos.length || null);
    const createdText = model ? formatCreatedDate(model.createdAt) : null;
    const fileSizeText = formatFileSize(plyInfo?.fileSizeBytes ?? localFile?.sizeBytes);
    const metaParts = jobId
        ? [createdText && `Created ${createdText}`, photoCount != null && `${photoCount} photos`]
        : ['Opened from your computer', fileSizeText];

    if (jobId && loadError) {
        return (
            <div className="model-screen">
                <button className="model-back" onClick={() => { playSound('back'); onBack(); }}>
                    <Icon name="arrowLeft" size={15} /> {backLabel}
                </button>
                <div className="forma-card model-missing">
                    <span className="model-missing-icon"><Icon name="triangle" size={22} /></span>
                    <h1 className="model-card-title">Couldn&apos;t open this model</h1>
                    <p className="model-muted">{loadError}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="model-screen">
            <button
                className="model-back"
                onClick={() => {
                    playSound('back');
                    onBack();
                }}
            >
                <Icon name="arrowLeft" size={15} /> {backLabel}
            </button>

            <div className="model-head">
                <div className="model-head-text">
                    <div className="model-title-row">
                        <h1 className="model-title">{modelName}</h1>
                        {jobId && model && (
                            <button className="model-icon-btn" onClick={openRenameDialog} aria-label="Rename model" title="Rename">
                                <Icon name="edit" size={16} />
                            </button>
                        )}
                        <span className={jobId ? 'model-badge' : 'model-badge is-local'}>{jobId ? 'Ready' : 'Local file'}</span>
                    </div>
                    <p className="model-meta">{metaParts.filter(Boolean).join(' \u00B7 ')}</p>
                </div>

                {jobId && (
                    <div className="model-actions">
                        <a
                            className="forma-btn forma-btn-primary model-download"
                            href={plyUrl}
                            download={`${(model?.name || 'model').replace(/[^\w.-]+/g, '_')}.ply`}
                            onClick={() => playSound('tap')}
                        >
                            <Icon name="download" size={15} /> Download .ply
                        </a>
                        <button
                            className="forma-btn"
                            disabled={!model}
                            onClick={() => {
                                playSound('confirm');
                                onAddToScene({ id: jobId, name: modelName });
                            }}
                        >
                            <Icon name="shield" size={15} /> Add to scene
                        </button>
                    </div>
                )}
            </div>

            <div className={jobId ? 'model-body' : 'model-body is-local'}>
                <div className="model-viewer" ref={viewerCardRef}>
                    {/* Both renderers show their own loading progress. */}
                    {plyUrl && <SplatViewer url={plyUrl} isEmbedded />}
                    <button className="model-icon-btn model-fullscreen" onClick={toggleFullScreen} aria-label="Full screen" title="Full screen">
                        <Icon name="fullscreen" size={16} />
                    </button>
                    <span className="model-viewer-hint">Drag to orbit {'\u00B7'} right-drag to pan {'\u00B7'} scroll to zoom</span>
                </div>

                <aside className="model-side">
                    <div className="forma-card model-card">
                        <h2 className="model-card-title">Details</h2>
                        <dl className="model-details">
                            {jobId && photoCount != null && (
                                <><dt>Source photos</dt><dd>{photoCount}</dd></>
                            )}
                            {jobId && model?.removeBackground != null && (
                                <><dt>Background removed</dt><dd>{model.removeBackground ? 'Yes' : 'No'}</dd></>
                            )}
                            {plyInfo?.splatCount != null && (
                                <><dt>Splats</dt><dd>{plyInfo.splatCount.toLocaleString()}</dd></>
                            )}
                            {fileSizeText && (
                                <><dt>File size</dt><dd>{fileSizeText} .ply</dd></>
                            )}
                            {!jobId && (
                                <><dt>File</dt><dd className="model-file-name">{localFile?.name}</dd></>
                            )}
                        </dl>
                    </div>

                    {jobId && photos.length > 0 && (
                        <div className="forma-card model-card">
                            <h2 className="model-card-title">Source photos</h2>
                            <div className="model-photos">
                                {photos.slice(0, PHOTO_PREVIEW_COUNT).map((photo) => (
                                    <img key={photo.name} src={photo.url} alt="" loading="lazy" />
                                ))}
                                {photos.length > PHOTO_PREVIEW_COUNT && (
                                    <span className="model-photos-more">+{photos.length - PHOTO_PREVIEW_COUNT}</span>
                                )}
                            </div>
                            <button
                                className="model-link"
                                onClick={() => {
                                    playSound('tap');
                                    onOpenPhotos();
                                }}
                            >
                                Open in Media Library
                            </button>
                        </div>
                    )}

                    {jobId && model && (
                        <div className="forma-card model-card">
                            <h2 className="model-card-title">Manage</h2>
                            <div className="model-manage">
                                <button className="forma-btn" onClick={openRenameDialog}>
                                    <Icon name="edit" size={14} /> Rename
                                </button>
                                <button className="forma-btn model-delete" onClick={openDeleteDialog}>
                                    <Icon name="trash" size={14} /> Delete model
                                </button>
                            </div>
                        </div>
                    )}
                </aside>
            </div>

            {dialog && <ActionDialog {...dialog} onCancel={() => setDialog(null)} />}
            {showNamePrompt && jobId && (
                <NameModelPrompt
                    jobId={jobId}
                    onClose={() => {
                        onNamePromptClose();
                        // Show the new name.
                        setReloadCount((count) => count + 1);
                    }}
                />
            )}
        </div>
    );
}

export default ModelScreen;