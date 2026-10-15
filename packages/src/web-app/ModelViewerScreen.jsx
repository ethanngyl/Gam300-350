/*!************************************************************************
\file ModelViewerScreen.jsx
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Model Viewer tab: picks a Gaussian splat to open in the full-page
SplatViewer. Lists every finished model from GET /jobs as a searchable
grid, and has an "Open .ply file" button that loads a .ply from the
user's computer instead. Opening is left to the parent: onOpenModel(jobId)
for a server model, onOpenFile(file) for a local one.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

function ModelViewerScreen({ onOpenModel, onOpenFile }) {
    const [search, setSearch] = useState('');
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
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
        return () => { isCancelled = true; };
    }, []);

    // Only finished jobs have a result.ply to view.
    const normalizedSearch = search.trim().toLowerCase();
    const models = jobs
        .filter((job) => job.status === 'done')
        .map((job) => ({
            id: job.id,
            name: `Model ${job.id.slice(0, 8)}`,
            photoCount: job.images?.length ?? 0,
        }))
        .filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(normalizedSearch));

    function handleFileChange(event) {
        const file = event.target.files?.[0];
        // Clear the input so picking the same file again still fires onChange.
        event.target.value = '';
        if (file) onOpenFile(file);
    }

    return (
        <div className="library-screen">
            <div className="library-toolbar">
                <div className="library-subtabs">
                    <span className="library-subtab is-active">Model Viewer</span>
                </div>

                <label className="library-search">
                    <Icon name="search" size={14} />
                    <input
                        placeholder="Search..."
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                </label>

                <button
                    className="forma-btn forma-btn-primary"
                    onClick={() => {
                        playSound('click');
                        fileInputRef.current?.click();
                    }}
                >
                    <Icon name="folder" size={14} /> Open .ply file
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".ply"
                    hidden
                    onChange={handleFileChange}
                />
            </div>

            {isLoading && <p className="library-note">Loading...</p>}
            {loadError && (
                <p className="library-note library-note-error">Couldn't load models: {loadError}</p>
            )}
            {!isLoading && !loadError && models.length === 0 && (
                <p className="library-note">
                    {normalizedSearch
                        ? 'No models match your search.'
                        : 'No finished models yet. Open a .ply file from your computer to view it.'}
                </p>
            )}

            <div className="library-grid">
                {models.map((model) => (
                    <button
                        key={model.id}
                        type="button"
                        className="forma-card library-item library-item-button"
                        onClick={() => {
                            playSound('click');
                            onOpenModel(model.id);
                        }}
                    >
                        <div className="library-thumb">
                            <span className="forma-badge forma-badge-ready">Ready</span>
                            <Icon name="cube" size={44} />
                        </div>
                        <div className="library-item-name">{model.name}</div>
                        <div className="library-item-meta">
                            <span>{model.photoCount} photos</span>
                            <span>Click to view</span>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

export default ModelViewerScreen;
