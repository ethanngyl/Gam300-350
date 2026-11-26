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
variant. The 3D Models grid is built from GET /jobs, laid out like the
Figma: a finished model's card shows the object cut out of one of its
photos, or its first photo (see ModelCover.jsx), with "Created <date>" and
a menu button; a model still being built shows its current step and a
progress bar instead (the list refreshes every few seconds while one is
building). Failed or cancelled jobs are hidden.
Clicking a finished card (or Enter on it) opens it on the model page
(onOpenModel); the menu button or a right-click renames or deletes it. The active sub-tab is controlled by the parent
so other pages (such as Home's "View all") can open either one directly.
Both sub-views share the search box and the sort menu (SortMenu.jsx).
**************************************************************************/

import { useCallback, useEffect, useState } from 'react';
import Icon from './Icons.jsx';
import ImageGallery from './ImageGallery.jsx';
import ContextMenu from './ContextMenu.jsx';
import { menuPosition } from './menuPosition.js';
import ActionDialog from './ActionDialog.jsx';
import ModelCover from './ModelCover.jsx';
import SortMenu from './SortMenu.jsx';
import { deleteJob, jobDisplayName, renameJob } from './mediaApi.js';
import { BUILD_STEPS, buildStepIndex } from './useBackgroundBuilds.js';

// Statuses where a job has stopped for good. 'done' is the only one that
// produces a model; the others are hidden from the grid.
const FINISHED_STATUSES = ['done', 'error', 'cancelled'];

// The sort orders, in the order the sort menu lists them.
const SORT_OPTIONS = [
    { id: 'newest', label: 'Newest' },
    { id: 'oldest', label: 'Oldest' },
    { id: 'lastEdited', label: 'Last edited' },
    { id: 'name', label: 'Name' },
];

// How often the list refreshes while a model is building, in milliseconds.
const BUILDING_REFRESH_MS = 5000;

// "15 Sep" (or "15 Sep 2025" for an older year).
function formatShortDate(timestamp) {
    const date = new Date(timestamp);
    const options = { day: 'numeric', month: 'short' };
    if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
    return date.toLocaleDateString('en-SG', options);
}

// "Started 2 minutes ago" for a model still building.
function startedText(timestamp) {
    const minutesAgo = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutesAgo < 1) return 'Started just now';
    if (minutesAgo < 60) return `Started ${minutesAgo} minute${minutesAgo === 1 ? '' : 's'} ago`;
    const hoursAgo = Math.floor(minutesAgo / 60);
    return `Started ${hoursAgo} hour${hoursAgo === 1 ? '' : 's'} ago`;
}

// When a model was last changed, for the "Last edited" sort. Falls back to
// when it was made if the server has no update time.
function lastEditedTime(model) {
    return Date.parse(model.updatedAt ?? model.createdAt) || 0;
}

function LibraryScreen({ subTab, onSubTabChange, onOpenModel }) {
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
                const res = await fetch('/api/v1/jobs');
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

    // While a model is building, refresh the list so its progress moves and
    // it turns into a finished card when done.
    const isAnyBuilding = jobs.some((job) => !FINISHED_STATUSES.includes(job.status));
    useEffect(() => {
        if (subTab !== 'models' || !isAnyBuilding) return undefined;
        const timerId = setInterval(async () => {
            try {
                const res = await fetch('/api/v1/jobs');
                if (res.ok) setJobs(await res.json());
            } catch {
                // Server unreachable for a moment: try again next time.
            }
        }, BUILDING_REFRESH_MS);
        return () => clearInterval(timerId);
    }, [subTab, isAnyBuilding]);

    // Only finished jobs (real models) and jobs still running are shown.
    const models = jobs
        .filter((job) => job.status === 'done' || !FINISHED_STATUSES.includes(job.status))
        .map((job) => ({
            id: job.id,
            name: jobDisplayName(job, 'Model'),
            customName: job.name ?? '',
            photoCount: job.images?.length ?? 0,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            isReady: job.status === 'done',
            isQueued: job.status === 'queued',
            phase: job.phase,
            progress: job.progress ?? 0,
            coverUrl: job.cover ?? null,
            photoUrl: job.images?.[0]?.url ?? null,
        }));

    const normalizedSearch = search.trim().toLowerCase();
    const visibleModels = models.filter((model) =>
        `${model.name} ${model.id}`.toLowerCase().includes(normalizedSearch)
    );
    if (sortOrder === 'oldest') visibleModels.reverse();
    if (sortOrder === 'lastEdited') visibleModels.sort((a, b) => lastEditedTime(b) - lastEditedTime(a));
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
                setDialog(null);
            },
        });
    }

    return (
        <div className="library-screen">
            {/* Wider screens only (Pages.css); phones keep the tabs as the heading. */}
            <h1 className="page-title">Media Library</h1>
            <div className="library-toolbar">
                <div className="library-subtabs">
                    <button
                        className={subTab === 'models' ? 'library-subtab is-active' : 'library-subtab'}
                        onClick={() => {
                            onSubTabChange('models');
                        }}
                    >
                        3D Models
                    </button>
                    <button
                        className={subTab === 'photos' ? 'library-subtab is-active' : 'library-subtab'}
                        onClick={() => {
                            onSubTabChange('photos');
                        }}
                    >
                        Photos
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

                <SortMenu options={SORT_OPTIONS} value={sortOrder} onChange={setSortOrder} />
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
                                : 'No generated models yet. Use New model to create one.'}
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
                                title={model.isReady ? 'Click to open' : undefined}
                                onClick={() => {
                                    if (!model.isReady) return;
                                    onOpenModel(model.id);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && model.isReady) onOpenModel(model.id);
                                }}
                                onContextMenu={(event) => openModelMenu(event, model)}
                            >
                                <div className="library-thumb">
                                    {model.isReady ? (
                                        <ModelCover coverUrl={model.coverUrl} photoUrl={model.photoUrl} icon="layers" />
                                    ) : (
                                        <div className="library-building">
                                            <strong>
                                                {model.isQueued
                                                    ? 'Waiting to start'
                                                    : BUILD_STEPS[Math.min(buildStepIndex(model), BUILD_STEPS.length - 1)].label}
                                            </strong>
                                            <span className="library-building-row">
                                                <span className="library-building-bar">
                                                    <span style={{ width: `${Math.round(model.progress * 100)}%` }} />
                                                </span>
                                                <span>{Math.round(model.progress * 100)}%</span>
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <div className="library-item-footer">
                                    <div className="library-item-copy">
                                        <div className="library-item-name">{model.name}</div>
                                        <div className="library-item-meta">
                                            <span>
                                                {model.isReady ? `Created ${formatShortDate(model.createdAt)}` : startedText(model.createdAt)}
                                            </span>
                                        </div>
                                    </div>
                                    {model.isReady && (
                                        <button
                                            type="button"
                                            className="library-item-more"
                                            aria-label={`More for ${model.name}`}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                openModelMenu(event, model);
                                            }}
                                        >
                                            <Icon name="more" size={16} />
                                        </button>
                                    )}
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