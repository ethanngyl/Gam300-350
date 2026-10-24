/*!************************************************************************
\file HomeScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Dashboard landing screen (theme 2): a personalised welcome and a "Recent"
section with two tabs. "Your files" shows the latest photo batches and
opens the Photo Library; "Generated models" shows the latest finished
models and opens one in the full-page viewer. Both come from GET /jobs.
With nothing made yet, it shows a single "New model" call to action.
**************************************************************************/

import { useEffect, useState } from 'react';
import Icon from './Icons.jsx';
import { jobDisplayName } from './mediaApi.js';
import { playSound } from '../audio/Audio.js';

// How many cards each Recent tab shows.
const RECENT_ITEM_COUNT = 10;

const RECENT_TABS = [
    { id: 'files', label: 'Your files' },
    { id: 'models', label: 'Generated models' },
];

function pluralize(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// "Just now", "5m ago", "3h ago", "Yesterday", "4d ago", or a date.
function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const minutesAgo = Math.floor((Date.now() - timestamp) / 60000);
    if (minutesAgo < 1) return 'Just now';
    if (minutesAgo < 60) return `${minutesAgo}m ago`;
    const hoursAgo = Math.floor(minutesAgo / 60);
    if (hoursAgo < 24) return `${hoursAgo}h ago`;
    const daysAgo = Math.floor(hoursAgo / 24);
    if (daysAgo === 1) return 'Yesterday';
    if (daysAgo < 7) return `${daysAgo}d ago`;
    return new Date(timestamp).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}

function HomeScreen({ userName, onNewGeneration, onOpenLibrary, onOpenModel }) {
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [recentTab, setRecentTab] = useState('files');

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
        // Ignore the response if the user leaves Home before it arrives.
        return () => { isCancelled = true; };
    }, []);

    // Assumes the server lists the newest job first (same as the Library).
    const recentFiles = jobs
        .filter((job) => (job.images?.length ?? 0) > 0)
        .slice(0, RECENT_ITEM_COUNT)
        .map((job) => ({
            id: job.id,
            name: jobDisplayName(job, 'Photos'),
            kind: job.status === 'done' ? pluralize(job.images.length, 'photo') : 'Processing',
            coverUrl: job.images[0].url,
            createdAt: job.createdAt,
        }));

    const recentModels = jobs
        .filter((job) => job.status === 'done')
        .slice(0, RECENT_ITEM_COUNT)
        .map((job) => ({
            id: job.id,
            name: jobDisplayName(job, 'Model'),
            kind: '3D model',
            coverUrl: job.images?.[0]?.url ?? null,
            createdAt: job.createdAt,
        }));

    const isShowingFiles = recentTab === 'files';
    const recentItems = isShowingFiles ? recentFiles : recentModels;
    const hasAnything = jobs.length > 0;

    function openItem(item) {
        playSound('click');
        if (isShowingFiles) onOpenLibrary('photos');
        else onOpenModel(item.id);
    }

    function startNewModel() {
        playSound('click');
        onNewGeneration();
    }

    return (
        <div className="home-screen home-screen-v2">
            <div className="home-welcome">
                <p className="eyebrow eyebrow-accent">Default workspace</p>
                <h1>Welcome back, {userName}</h1>
                <p className="home-subtitle">Turn photos and video frames into polished 3D assets.</p>
            </div>

            <div className="home-recent-v2">
                <div className="home-recent-v2-header">
                    <div>
                        <h2 className="home-section-title">Recent</h2>
                        <div className="home-recent-tabs" role="tablist">
                            {RECENT_TABS.map((tab) => (
                                <button
                                    key={tab.id}
                                    role="tab"
                                    aria-selected={recentTab === tab.id}
                                    className={recentTab === tab.id ? 'home-recent-tab is-active' : 'home-recent-tab'}
                                    onClick={() => {
                                        playSound('click');
                                        setRecentTab(tab.id);
                                    }}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <button
                        className="forma-btn"
                        onClick={() => {
                            playSound('click');
                            onOpenLibrary(isShowingFiles ? 'photos' : 'models');
                        }}
                    >
                        View all {isShowingFiles ? 'files' : 'models'}
                    </button>
                </div>

                {isLoading && <p className="home-recent-note">Loading...</p>}
                {loadError && <p className="home-recent-note">Couldn't load your work: {loadError}</p>}

                {!isLoading && !loadError && !hasAnything && (
                    <div className="forma-card home-empty">
                        <Icon name="camera" size={26} />
                        <h3>Create your first 3D model</h3>
                        <p>Take or upload photos of an object from every angle, and GENESIS builds the model for you.</p>
                        <button className="forma-btn forma-btn-primary" onClick={startNewModel}>
                            <Icon name="camera" size={14} /> New model
                        </button>
                    </div>
                )}

                {!isLoading && !loadError && hasAnything && recentItems.length === 0 && (
                    <p className="home-recent-note">
                        {isShowingFiles ? 'No photos yet.' : 'No finished models yet. Models still processing appear here when done.'}
                    </p>
                )}

                {recentItems.length > 0 && (
                    <div className="home-file-grid">
                        {recentItems.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className="forma-card home-file-card"
                                onClick={() => openItem(item)}
                            >
                                <span className="home-file-preview">
                                    {item.coverUrl ? (
                                        <img src={item.coverUrl} alt="" loading="lazy" />
                                    ) : (
                                        <Icon name="layers" size={26} />
                                    )}
                                    <span className="home-file-type">
                                        <Icon name={isShowingFiles ? 'image' : 'layers'} size={12} />
                                    </span>
                                </span>
                                <span className="home-file-copy">
                                    <span className="home-file-name">{item.name}</span>
                                    <span className="home-file-kind">{item.kind}</span>
                                    <span className="home-file-time">{formatTimeAgo(item.createdAt)}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default HomeScreen;