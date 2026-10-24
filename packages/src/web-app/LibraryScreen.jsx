/*!************************************************************************
\file LibraryScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 09-10-2026
\brief
Library tab with two sub-views: a searchable, sortable grid of generated
3D models and a Photo Library that embeds ImageGallery in its compact
variant. The 3D Models grid is built from GET /jobs: finished jobs show
as Ready, jobs still running show as Processing, and failed or cancelled
jobs are hidden. Viewing a model is left to the Model Viewer tab;
right-clicking a card here renames or deletes it. The active sub-tab is
controlled by the parent so the sidebar can open either one directly.
**************************************************************************/

import { useCallback, useEffect, useState } from 'react';
import Icon from './Icons.jsx';
import ImageGallery from './ImageGallery.jsx';
import ContextMenu from './ContextMenu.jsx';
import { menuPosition } from './menuPosition.js';
import ActionDialog from './ActionDialog.jsx';
import { deleteJob, jobDisplayName, renameJob } from './mediaApi.js';
import { playSound } from '../audio/Audio.js';

// Statuses where a job has stopped for good. 'done' is the only one that
// produces a model; the others are hidden from the grid.
const FINISHED_STATUSES = ['done', 'error', 'cancelled'];

function LibraryScreen({ subTab, onSubTabChange, onGenerateModel, onUploadPhotos }) {
    const [search, setSearch] = useState('');
    const [sortOrder, setSortOrder] = useState('newest');
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    // Open right-click menu ({ x, y, items }) and rename/delete dialog (ActionDialog props).
    const [menu, setMenu] = useState(null);
    const [dialog, setDialog] = useState(null);
    const closeMenu = useCallback(() => setMenu(null), []);
    const closeDialog = useCallback(() => setDialog(null), []);

    // Fetch the job list whenever the 3D Models sub-tab is opened, so a model
    // that finished since the last visit shows up without a page reload.
    useEffect(() => {
        if (subTab !== 'models') return;

        let isCancelled = false;

        async function loadJobs() {
            try {
                const res = await fetch('/jobs');
                if (!res.ok) throw new Error(`Server returned ${res.status}`);
                const data = await res.json();
                if (!isCancelled) {
                    setJobs(data);
                    setLoadError(null);
                }
            } catch (err) {
                if (!isCancelled) setLoadError(err.message);
            } finally {
                if (!isCancelled) setIsLoading(false);
            }
        }

        loadJobs();
        // Ignore the response if the user leaves the tab before it arrives.
        return () => { isCancelled = true; };
    }, [subTab]);

    // Only finished jobs (real models) and jobs still running are shown.
    const models = jobs
        .filter((job) => job.status === 'done' || !FINISHED_STATUSES.includes(job.status))
        .map((job) => ({
            id: job.id,
            name: jobDisplayName(job, 'Model'),
            customName: job.name ?? '',
            photoCount: job.images?.length ?? 0,
            createdAt: job.createdAt,
            isReady: job.status === 'done',
        }));

    const normalizedSearch = search.trim().toLowerCase();
    const visibleModels = models.filter((model) =>
        `${model.name} ${model.id}`.toLowerCase().includes(normalizedSearch)
    );
    if (sortOrder === 'oldest') visibleModels.reverse();
    if (sortOrder === 'name') visibleModels.sort((a, b) => a.name.localeCompare(b.name));

    function openModelMenu(event, model) {
        event.preventDefault();
        setMenu({
            ...menuPosition(event),
            items: [
                { label: 'Rename', icon: 'edit', onSelect: () => openRenameDialog(model) },
                { label: 'Delete', icon: 'trash', danger: true, onSelect: () => openDeleteDialog(model) },
            ],
        });
    }

    function openRenameDialog(model) {
        setDialog({
            title: 'Rename model',
            message: 'Also renames its .ply in the engine samples folder (spaces become _). '
                + 'Leave empty to use the default name.',
            initialValue: model.customName || model.name,
            confirmLabel: 'Rename',
            onConfirm: async (name) => {
                const result = await renameJob(model.id, name);
                setJobs((current) =>
                    current.map((job) => (job.id === model.id ? { ...job, name: result.name } : job))
                );
                playSound('tap');
                setDialog(null);
            },
        });
    }

    function openDeleteDialog(model) {
        const photos = model.photoCount === 1 ? '1 source photo' : `${model.photoCount} source photos`;
        setDialog({
            title: `Delete ${model.name}?`,
            message: model.isReady
                ? `This permanently deletes the model and its ${photos}.`
                : `This stops processing and permanently deletes its ${photos}.`,
            confirmLabel: 'Delete',
            danger: true,
            onConfirm: async () => {
                await deleteJob(model.id);
                setJobs((current) => current.filter((job) => job.id !== model.id));
                playSound('tap');
                setDialog(null);
            },
        });
    }

    return (
        <div className="library-screen">
            <div className="library-toolbar">
                <div className="library-subtabs">
                    <button
                        className={subTab === 'models' ? 'library-subtab is-active' : 'library-subtab'}
                        onClick={() => onSubTabChange('models')}
                    >
                        3D Models
                    </button>
                    <button
                        className={subTab === 'photos' ? 'library-subtab is-active' : 'library-subtab'}
                        onClick={() => onSubTabChange('photos')}
                    >
                        Photo Library
                    </button>
                </div>

                <label className="library-search">
                    <Icon name="search" size={14} />
                    <input
                        placeholder="Search..."
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                </label>

                <label className="library-sort">
                    <Icon name="filter" size={13} />
                    <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                        <option value="name">Name</option>
                    </select>
                    <Icon name="chevron" size={13} />
                </label>

                {subTab === 'models' ? (
                    <button className="forma-btn forma-btn-primary" onClick={onGenerateModel}>
                        <Icon name="plus" size={14} /> Generate Model
                    </button>
                ) : (
                    <button className="forma-btn forma-btn-primary" onClick={onUploadPhotos}>
                        <Icon name="plus" size={14} /> Upload Photos
                    </button>
                )}
            </div>

            {subTab === 'models' ? (
                <>
                    {isLoading && <p className="library-note">Loading...</p>}
                    {loadError && (
                        <p className="library-note library-note-error">Couldn't load models: {loadError}</p>
                    )}
                    {!isLoading && !loadError && visibleModels.length === 0 && (
                        <p className="library-note">
                            {normalizedSearch
                                ? 'No models match your search.'
                                : 'No generated models yet. Use Generate Model to create one.'}
                        </p>
                    )}

                    <div className="library-grid">
                        {visibleModels.map((model) => (
                            <div
                                key={model.id}
                                // Focusable so the keyboard menu key can open the menu too.
                                tabIndex={0}
                                className={
                                    model.isReady
                                        ? 'forma-card library-item library-item-actionable'
                                        : 'forma-card library-item library-item-actionable is-processing'
                                }
                                title="Right-click to rename or delete"
                                onContextMenu={(event) => openModelMenu(event, model)}
                            >
                                <div className="library-thumb">
                                    <span
                                        className={
                                            model.isReady
                                                ? 'forma-badge forma-badge-ready'
                                                : 'forma-badge forma-badge-processing'
                                        }
                                    >
                                        {model.isReady ? 'Ready' : 'Processing'}
                                    </span>
                                    <Icon name="layers" size={44} />
                                </div>
                                <div className="library-item-name">{model.name}</div>
                                <div className="library-item-meta">
                                    <span>{model.photoCount} photos</span>
                                    <span>
                                        {model.isReady
                                            ? new Date(model.createdAt).toLocaleDateString()
                                            : 'In progress'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                // Live data: fetched and owned by ImageGallery's own load() logic.
                <ImageGallery variant="compact" searchTerm={search} sortOrder={sortOrder} />
            )}

            {menu && <ContextMenu {...menu} onClose={closeMenu} />}
            {dialog && <ActionDialog {...dialog} onCancel={closeDialog} />}
        </div>
    );
}

export default LibraryScreen;