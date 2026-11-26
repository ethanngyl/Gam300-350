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
a build finishes. On wider screens it follows the Figma's model detail
page: a link back to where it was opened from (e.g. "Media Library") above
the model's name (pencil to rename) and when it was made, then the 3D
viewer in a large card (SplatViewer, embedded, with its renderer and view
controls, plus a full-screen button) and, beside it, one panel: "Built
from N photos" with a few of them and View all, the details (background,
splats, file size, format, created), then Open in Scene builder, Export
.obj (ExportObjDialog, the engine's OBJ export in the browser), Download
.ply and Delete model. Rename and delete use the Library's dialog and
calls (mediaApi).
A .ply opened from the user's computer uses the same page with only the
viewer, its file details and Export .obj. A .obj opened from the user's
computer is shown with ObjViewer, with its vertex and triangle counts.
On phones it follows the mobile Figma: a header with a back button, the
model's name and a menu (Rename, Delete), then the viewer, the name with a
READY badge, the same panel ("Built from N photos", the details), and
Export model, which opens a sheet (.ply file / .obj file). Phones have no
Scene Builder, so App passes no onAddToScene there and Add to scene is
hidden.
Right after a build, showNamePrompt asks for the model's name first.
- ModelScreen({ jobId, localFile, backLabel, showNamePrompt, onNamePromptClose,
  onBack, onOpenPhotos, onAddToScene, onDeleted })
React component. jobId for a server model, or localFile ({ url, name,
sizeBytes }) for a .ply or .obj from the user's computer.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import ActionDialog from './ActionDialog.jsx';
import Icon from './Icons.jsx';
import ExportObjDialog from './ExportObjDialog.jsx';
import NameModelPrompt from './NameModelPrompt.jsx';
import ObjViewer from './ObjViewer.jsx';
import SplatViewer from './SplatViewer.jsx';
import { deleteJob, jobDisplayName, renameJob } from './mediaApi.js';
import { smallPhotoUrl } from './LibraryPhotos.js';
import { readPlyInfo } from './plyHeader.js';
import { useMobileView } from './useMobileView.js';
import { playSound } from '../audio/Audio.js';
import './ModelScreen.css';

// How many source photos the side card shows before "+N" (phones), and the
// wider screens' "Built from" grid shows.
const PHOTO_PREVIEW_COUNT = 7;
const BUILT_FROM_PHOTO_COUNT = 8;

// "2 Nov 2026, 9:41 pm"
function formatCreatedDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('en-SG', {
        day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
}

// "15 Sep 2026"
function formatShortDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
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
    // From ObjViewer once a .obj is loaded: { vertexCount, triangleCount }.
    const [objInfo, setObjInfo] = useState(null);
    const [isExportOpen, setIsExportOpen] = useState(false);
    // Phones: the "Export model" sheet (.ply file / .obj file), as in the Figma.
    const [isExportSheetOpen, setIsExportSheetOpen] = useState(false);
    // Rename / delete dialog (ActionDialog props), or null.
    const [dialog, setDialog] = useState(null);
    // Bumped to load the model again (after naming it).
    const [reloadCount, setReloadCount] = useState(0);
    // Phones: whether the header's menu (Rename, Delete) is open.
    const [isPhoneMenuOpen, setIsPhoneMenuOpen] = useState(false);
    // The model (job id or local file) the open sound last played for, so it
    // plays once per model, not again after a rename reloads it.
    const soundedModelRef = useRef(null);
    const viewerCardRef = useRef(null);
    const phoneMenuRef = useRef(null);
    const isPhone = useMobileView();

    // The phone header's menu closes on a click outside it or on Escape.
    useEffect(() => {
        if (!isPhoneMenuOpen) return undefined;
        function closeOnOutsideClick(event) {
            if (!phoneMenuRef.current?.contains(event.target)) setIsPhoneMenuOpen(false);
        }
        function closeOnEscape(event) {
            if (event.key === 'Escape') setIsPhoneMenuOpen(false);
        }
        document.addEventListener('pointerdown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isPhoneMenuOpen]);

    // The export sheet closes on Escape.
    useEffect(() => {
        if (!isExportSheetOpen) return undefined;
        function closeOnEscape(event) {
            if (event.key === 'Escape') setIsExportSheetOpen(false);
        }
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [isExportSheetOpen]);

    // Server models are always .ply; a local file is whatever the user picked.
    const isObj = !jobId && /\.obj$/i.test(localFile?.name ?? '');
    const modelUrl = jobId ? `/api/v1/jobs/${jobId}/result.ply` : localFile?.url;
    const plyUrl = isObj ? null : modelUrl;
    const modelName = jobId
        ? (model ? jobDisplayName(model, 'Model') : 'Loading...')
        : localFile?.name;
    // Exported file name: the model's name, or the local file's without its extension.
    const exportName = jobId ? (model?.name || 'model') : (localFile?.name ?? 'model').replace(/\.[^.]+$/, '');

    useEffect(() => {
        if (!jobId) return;
        let isCancelled = false;

        async function loadModel() {
            try {
                const res = await fetch('/api/v1/jobs');
                if (!res.ok) throw new Error(`Server returned ${res.status}`);
                const allJobs = await res.json();
                const thisJob = Array.isArray(allJobs) ? allJobs.find((listedJob) => listedJob.id === jobId) : null;
                if (!thisJob) throw new Error('This model no longer exists.');
                // /jobs has no removeBackground; /jobs/:id does.
                const detailRes = await fetch(`/api/v1/jobs/${jobId}`);
                const detail = detailRes.ok ? await detailRes.json() : {};
                if (isCancelled) return;
                setModel({ ...thisJob, removeBackground: detail.removeBackground ?? null });
                setLoadError(null);
                if (soundedModelRef.current !== jobId) {
                    soundedModelRef.current = jobId;
                    playSound('open');
                }
            } catch (err) {
                if (isCancelled) return;
                setLoadError(err.message);
                playSound('error');
            }
        }

        loadModel();
        return () => {
            isCancelled = true;
        };
    }, [jobId, reloadCount]);

    // A file from the user's computer: the open sound once it is shown.
    useEffect(() => {
        if (jobId || !localFile || soundedModelRef.current === localFile) return;
        soundedModelRef.current = localFile;
        playSound('open');
    }, [jobId, localFile]);

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
                <button className="model-back" onClick={() => { onBack(); }}>
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
            {isPhone && (
                <div className="model-phone-header">
                    <button
                        className="model-round-btn"
                        aria-label={`Back to ${backLabel}`}
                        onClick={() => {
                            onBack();
                        }}
                    >
                        <Icon name="arrowLeft" size={18} />
                    </button>
                    <span className="model-phone-title">{modelName}</span>
                    {jobId && model ? (
                        <div className="model-phone-menu-anchor" ref={phoneMenuRef}>
                            <button
                                className="model-round-btn"
                                aria-label="More options"
                                aria-expanded={isPhoneMenuOpen}
                                onClick={() => {
                                    setIsPhoneMenuOpen((isOpen) => !isOpen);
                                }}
                            >
                                <Icon name="more" size={18} />
                            </button>
                            {isPhoneMenuOpen && (
                                <div className="app-menu model-phone-menu" role="menu">
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className="app-menu-item is-compact"
                                        onClick={() => {
                                            setIsPhoneMenuOpen(false);
                                            openRenameDialog();
                                        }}
                                    >
                                        <Icon name="edit" size={16} /> Rename
                                    </button>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className="app-menu-item is-compact model-delete"
                                        onClick={() => {
                                            setIsPhoneMenuOpen(false);
                                            openDeleteDialog();
                                        }}
                                    >
                                        <Icon name="trash" size={16} /> Delete model
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <span className="model-round-btn is-placeholder" aria-hidden="true" />
                    )}
                </div>
            )}

            <button
                className="model-back"
                onClick={() => {
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
                        {!jobId && <span className="model-badge is-local">Local file</span>}
                        {isPhone && jobId && model && <span className="model-badge">Ready</span>}
                    </div>
                    <p className="model-meta">{metaParts.filter(Boolean).join(' \u00B7 ')}</p>
                </div>

                {!jobId && plyUrl && (
                    <div className="model-actions">
                        <button
                            className="forma-btn forma-btn-primary"
                            onClick={() => {
                                setIsExportOpen(true);
                            }}
                        >
                            <Icon name="cube" size={15} /> Export .obj
                        </button>
                    </div>
                )}
            </div>

            <div className={jobId ? 'model-body' : 'model-body is-local'}>
                <div className="model-viewer" ref={viewerCardRef}>
                    {/* Both renderers show their own loading progress. */}
                    {plyUrl && <SplatViewer url={plyUrl} isEmbedded />}
                    {isObj && modelUrl && (
                        <ObjViewer url={modelUrl} sizeBytes={localFile?.sizeBytes} isEmbedded onInfo={setObjInfo} />
                    )}
                    <button className="model-icon-btn model-fullscreen" onClick={toggleFullScreen} aria-label="Full screen" title="Full screen">
                        <Icon name="fullscreen" size={16} />
                    </button>
                    <span className="model-viewer-hint">
                        {isPhone
                            ? <>Drag to orbit {'\u00B7'} pinch to zoom</>
                            : <>Drag to orbit {'\u00B7'} right-drag to pan {'\u00B7'} scroll to zoom</>}
                    </span>
                </div>

                {jobId ? (
                    <aside className="model-side">
                        <div className="forma-card model-card model-panel">
                            {photos.length > 0 && (
                                <div className="model-built-from">
                                    <div className="model-built-from-head">
                                        <h2 className="model-card-title">Built from {photoCount} photos</h2>
                                        <button
                                            className="model-link"
                                            onClick={() => {
                                                onOpenPhotos();
                                            }}
                                        >
                                            View all
                                        </button>
                                    </div>
                                    <div className="model-built-from-grid">
                                        {photos.slice(0, BUILT_FROM_PHOTO_COUNT).map((photo) => (
                                            <img key={photo.name} src={smallPhotoUrl(photo.url)} alt="" loading="lazy" />
                                        ))}
                                    </div>
                                </div>
                            )}

                            <dl className="model-details">
                                {model?.removeBackground != null && (
                                    <><dt>Background</dt><dd>{model.removeBackground ? 'Removed' : 'Kept'}</dd></>
                                )}
                                {plyInfo?.splatCount != null && (
                                    <><dt>Splats</dt><dd>{plyInfo.splatCount.toLocaleString()}</dd></>
                                )}
                                {fileSizeText && (
                                    <><dt>File size</dt><dd>{fileSizeText}</dd></>
                                )}
                                <dt>Format</dt><dd>PLY</dd>
                                {model && formatShortDate(model.createdAt) && (
                                    <><dt>Created</dt><dd>{formatShortDate(model.createdAt)}</dd></>
                                )}
                            </dl>

                            {isPhone ? (
                                // Phones: one Export button (the sheet), as in the Figma; delete is in the header's menu.
                                <div className="model-panel-actions">
                                    <button
                                        className="forma-btn forma-btn-primary"
                                        onClick={() => setIsExportSheetOpen(true)}
                                    >
                                        <Icon name="download" size={15} /> Export model
                                    </button>
                                    {onAddToScene && (
                                        <button
                                            className="forma-btn"
                                            disabled={!model}
                                            onClick={() => {
                                                onAddToScene({ id: jobId, name: modelName });
                                            }}
                                        >
                                            <Icon name="shield" size={15} /> Add to scene
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="model-panel-actions">
                                    <button
                                        className="forma-btn forma-btn-primary"
                                        disabled={!model}
                                        onClick={() => {
                                            onAddToScene({ id: jobId, name: modelName });
                                        }}
                                    >
                                        Open in Scene builder
                                    </button>
                                    <div className="model-panel-row">
                                        <button
                                            className="forma-btn"
                                            onClick={() => {
                                                setIsExportOpen(true);
                                            }}
                                        >
                                            Export .obj
                                        </button>
                                        <a
                                            className="forma-btn"
                                            href={plyUrl}
                                            download={`${(model?.name || 'model').replace(/[^\w.-]+/g, '_')}.ply`}
                                            onClick={() => playSound('save')}
                                        >
                                            Download .ply
                                        </a>
                                    </div>
                                    {model && (
                                        <button className="model-link model-delete-link" onClick={openDeleteDialog}>
                                            Delete model
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </aside>
                ) : (
                    <aside className="model-side">
                        <div className="forma-card model-card model-card-details">
                            <h2 className="model-card-title">Details</h2>
                            <dl className="model-details">
                                {jobId && photoCount != null && (
                                    <><dt>Source photos</dt><dd>{photoCount}</dd></>
                                )}
                                {jobId && model?.removeBackground != null && (
                                    <><dt>Background removed</dt><dd>{model.removeBackground ? 'Yes' : 'No'}</dd></>
                                )}
                                {!isObj && plyInfo?.splatCount != null && (
                                    <><dt>Splats</dt><dd>{plyInfo.splatCount.toLocaleString()}</dd></>
                                )}
                                {isObj && objInfo && (
                                    <><dt>Vertices</dt><dd>{objInfo.vertexCount.toLocaleString()}</dd></>
                                )}
                                {isObj && objInfo?.triangleCount > 0 && (
                                    <><dt>Triangles</dt><dd>{objInfo.triangleCount.toLocaleString()}</dd></>
                                )}
                                {fileSizeText && (
                                    <><dt>File size</dt><dd>{fileSizeText}</dd></>
                                )}
                                <dt>File format</dt><dd>{isObj ? '.obj' : '.ply'}</dd>
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
                                        <img key={photo.name} src={smallPhotoUrl(photo.url)} alt="" loading="lazy" />
                                    ))}
                                    {photos.length > PHOTO_PREVIEW_COUNT && (
                                        <span className="model-photos-more">+{photos.length - PHOTO_PREVIEW_COUNT}</span>
                                    )}
                                </div>
                                <button
                                    className="model-link"
                                    onClick={() => {
                                        onOpenPhotos();
                                    }}
                                >
                                    Open in Media Library
                                </button>
                            </div>
                        )}

                        {jobId && model && (
                            <div className="forma-card model-card model-card-manage">
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
                )}
            </div>

            {dialog && <ActionDialog {...dialog} onCancel={() => setDialog(null)} />}
            {isExportSheetOpen && (
                <div
                    className="model-sheet-backdrop"
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) setIsExportSheetOpen(false);
                    }}
                >
                    <div className="model-sheet" role="dialog" aria-modal="true" aria-labelledby="model-sheet-title">
                        <span className="model-sheet-handle" aria-hidden="true" />
                        <div className="model-sheet-head">
                            <h2 id="model-sheet-title">Export model</h2>
                            <button
                                type="button"
                                className="model-round-btn"
                                aria-label="Close"
                                onClick={() => setIsExportSheetOpen(false)}
                            >
                                <Icon name="close" size={14} />
                            </button>
                        </div>
                        <a
                            className="model-sheet-option"
                            href={plyUrl}
                            download={`${(model?.name || 'model').replace(/[^\w.-]+/g, '_')}.ply`}
                            onClick={() => {
                                playSound('save');
                                setIsExportSheetOpen(false);
                            }}
                        >
                            .ply file
                        </a>
                        <button
                            type="button"
                            className="model-sheet-option"
                            onClick={() => {
                                setIsExportSheetOpen(false);
                                setIsExportOpen(true);
                            }}
                        >
                            .obj file
                        </button>
                    </div>
                </div>
            )}

            {isExportOpen && plyUrl && (
                <ExportObjDialog
                    plyUrl={plyUrl}
                    fileName={exportName}
                    splatCount={plyInfo?.splatCount}
                    sizeBytes={plyInfo?.fileSizeBytes ?? localFile?.sizeBytes}
                    onClose={() => setIsExportOpen(false)}
                />
            )}
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