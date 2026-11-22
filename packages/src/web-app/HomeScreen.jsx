/*!************************************************************************
\file HomeScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 26-10-2026
\brief
Dashboard landing screen, laid out like the Genesis Figma: a "Get
Started" banner with three ways to start (Add photos opens the Add source
photos dialog, AddPhotosDialog.jsx, which hands the photos to the Photo
Editor; Frames from video opens the Video Extractor; Build a scene opens
the Scene Builder), then "Recent" with two tabs and a "View all" link.
Phones show only Recent, as in the mobile Figma (Capture is in the tab
bar). "Your models" (shown first) has the latest finished models and
opens one in the full-page viewer; "Your photos" has the latest photo
batches (tagged with their build's status: source photos, processing,
failed or cancelled) and opens the Photo Library. Both come from GET
/jobs. With nothing made yet, it says "Nothing here yet. Ready to make
your first model?" instead, as in the Figma.
**************************************************************************/

import { useEffect, useState } from 'react';
import AddPhotosDialog from './AddPhotosDialog.jsx';
import Icon from './Icons.jsx';
import { jobDisplayName } from './mediaApi.js';
import { smallPhotoUrl } from './LibraryPhotos.js';
import { playSound } from '../audio/Audio.js';
import './HomeScreen.css';

// How many cards each Recent tab shows.
const RECENT_ITEM_COUNT = 10;

// The banner's ways to start. 'photos' opens the Add source photos
// dialog; the others open that page.
const START_ACTIONS = [
    { id: 'photos', title: 'Add photos', hint: '40\u201380 overlapping shots', icon: 'upload' },
    { id: 'extractor', title: 'Frames from video', hint: 'Pick frames from a walkaround video', icon: 'play' },
    { id: 'scene', title: 'Build a scene', hint: 'Arrange models in a space', icon: 'cube' },
];

const RECENT_TABS = [
    { id: 'models', label: 'Your models' },
    { id: 'files', label: 'Your photos' },
];

// The tag under a photo batch's name, from its job's status. Failed and
// cancelled builds used to show as "Processing" forever.
function fileStatus(job) {
    const photoCount = job.images.length;
    if (job.status === 'done') return { kind: `Source photos \u00B7 ${photoCount}`, statusClassName: null };
    if (job.status === 'error') return { kind: `Failed \u00B7 ${photoCount} photos`, statusClassName: 'is-failed' };
    if (job.status === 'cancelled') return { kind: `Cancelled \u00B7 ${photoCount} photos`, statusClassName: 'is-cancelled' };
    return { kind: 'Processing', statusClassName: 'is-processing' };
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

function HomeScreen({ onEditPhotos, onNavigate, onOpenLibrary, onOpenModel }) {
    const [isAddPhotosOpen, setIsAddPhotosOpen] = useState(false);
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [recentTab, setRecentTab] = useState('models');

    useEffect(() => {
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
            ...fileStatus(job),
            coverUrl: smallPhotoUrl(job.images[0].url),
            createdAt: job.createdAt,
        }));

    const recentModels = jobs
        .filter((job) => job.status === 'done')
        .slice(0, RECENT_ITEM_COUNT)
        .map((job) => ({
            id: job.id,
            name: jobDisplayName(job, 'Model'),
            kind: '3D model',
            coverUrl: smallPhotoUrl(job.images?.[0]?.url),
            createdAt: job.createdAt,
        }));

    const isShowingFiles = recentTab === 'files';
    const recentItems = isShowingFiles ? recentFiles : recentModels;
    const hasAnything = jobs.length > 0;

    function openItem(item) {
        playSound('tap');
        if (isShowingFiles) onOpenLibrary('photos');
        else onOpenModel(item.id);
    }

    function startAction(actionId) {
        playSound('tap');
        if (actionId === 'photos') setIsAddPhotosOpen(true);
        else onNavigate(actionId);
    }

    return (
        <div className="home-screen">
            <section className="home-hero" aria-labelledby="home-hero-title">
                <span className="home-hero-art" aria-hidden="true" />
                <h1 id="home-hero-title" className="home-hero-title">Get Started</h1>
                <div className="home-hero-actions">
                    {START_ACTIONS.map((action) => (
                        <button
                            key={action.id}
                            type="button"
                            className="home-hero-action"
                            onClick={() => startAction(action.id)}
                        >
                            <span className="home-hero-action-icon"><Icon name={action.icon} size={18} /></span>
                            <span className="home-hero-action-title">{action.title}</span>
                            <span className="home-hero-action-hint">{action.hint}</span>
                        </button>
                    ))}
                </div>
            </section>

            <div className="home-recent-v2-header">
                <div className="home-recent-title-row">
                    <h2 className="home-section-title">Recent</h2>
                    <div className="home-recent-tabs" role="tablist">
                        {RECENT_TABS.map((tab) => (
                            <button
                                key={tab.id}
                                role="tab"
                                aria-selected={recentTab === tab.id}
                                className={recentTab === tab.id ? 'home-recent-tab is-active' : 'home-recent-tab'}
                                onClick={() => {
                                    playSound('tap');
                                    setRecentTab(tab.id);
                                }}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
                <button
                    className="home-view-all-link"
                    onClick={() => {
                        playSound('tap');
                        onOpenLibrary(isShowingFiles ? 'photos' : 'models');
                    }}
                >
                    View all {isShowingFiles ? 'photos' : 'models'} <Icon name="chevronRight" size={14} />
                </button>
            </div>

            {isLoading && <p className="home-recent-note">Loading...</p>}
            {loadError && <p className="home-recent-note">Couldn't load your work: {loadError}</p>}

            {!isLoading && !loadError && !hasAnything && (
                <p className="home-empty-note">Nothing here yet. Ready to make your first model?</p>
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
                                    <Icon name={isShowingFiles ? 'image' : 'layers'} size={13} />
                                </span>
                            </span>
                            <span className="home-file-copy">
                                <span className="home-file-name">{item.name}</span>
                                <span className="home-file-meta">
                                    <span className={item.statusClassName ? `home-file-kind ${item.statusClassName}` : 'home-file-kind'}>{item.kind}</span>
                                    <span className="home-file-time">{formatTimeAgo(item.createdAt)}</span>
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {isAddPhotosOpen && (
                <AddPhotosDialog
                    onClose={() => setIsAddPhotosOpen(false)}
                    onContinue={(files) => {
                        setIsAddPhotosOpen(false);
                        onEditPhotos(files);
                    }}
                />
            )}
        </div>
    );
}

export default HomeScreen;