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
as Ready and open the full-page splat viewer when clicked, jobs still
running show as Processing, and failed or cancelled jobs are hidden. The
active sub-tab is controlled by the parent so the sidebar can open
either one directly.
**************************************************************************/

import { useEffect, useState } from 'react';
import Icon from './Icons.jsx';
import ImageGallery from './ImageGallery.jsx';
import { playSound } from '../audio/Audio.js';

// Statuses where a job has stopped for good. 'done' is the only one that
// produces a model; the others are hidden from the grid.
const FINISHED_STATUSES = ['done', 'error', 'cancelled'];

function LibraryScreen({ subTab, onSubTabChange, onGenerateModel, onUploadPhotos, onOpenModel }) {
    const [search, setSearch] = useState('');
    const [sortOrder, setSortOrder] = useState('newest');
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

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
            name: `Model ${job.id.slice(0, 8)}`,
            photoCount: job.images?.length ?? 0,
            isReady: job.status === 'done',
        }));

    const normalizedSearch = search.trim().toLowerCase();
    const visibleModels = models.filter((model) =>
        `${model.name} ${model.id}`.toLowerCase().includes(normalizedSearch)
    );
    if (sortOrder === 'oldest') visibleModels.reverse();
    if (sortOrder === 'name') visibleModels.sort((a, b) => a.id.localeCompare(b.id));

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
                            <button
                                key={model.id}
                                type="button"
                                className="forma-card library-item library-item-button"
                                disabled={!model.isReady}
                                onClick={() => {
                                    playSound('click');
                                    onOpenModel(model.id);
                                }}
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
                                    <span>{model.isReady ? 'Click to view' : 'In progress'}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </>
            ) : (
                // Live data: fetched and owned by ImageGallery's own load() logic.
                <ImageGallery variant="compact" searchTerm={search} sortOrder={sortOrder} />
            )}
        </div>
    );
}

export default LibraryScreen;