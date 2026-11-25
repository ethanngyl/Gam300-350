/*!************************************************************************
\file HomeScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 26-10-2026
\brief
Dashboard landing screen, laid out like the Genesis Figma: a "Get
Started" banner with a line on what Genesis does, "Quick tools" with three
ways to start (Add photos opens the New model dialog, AddPhotosDialog.jsx,
through onNewModel; Frames from videos opens the Video Extractor; Build a
scene opens the Scene Builder), then "Recent" with two tabs and a "View
all" link. Phones show only Recent, as in the mobile Figma (Capture is in
the tab bar). "Your models" (shown first) has the latest finished models,
shown by their cut-out covers (ModelCover.jsx), and opens one on the model
page; "Your photos" has the latest photo batches (tagged with their
build's status: source photos, processing, failed or cancelled) and opens
the Photo Library. Both come from GET /jobs. With no models yet, it says
"No models yet. Click New to start one from photos or a video." with
Upload photos and, when the server has it, Open the sample model (the
cat statue sample job), as in the Figma.
**************************************************************************/

import { useEffect, useState } from 'react';
import Icon from './Icons.jsx';
import ModelCover from './ModelCover.jsx';
import { jobDisplayName } from './mediaApi.js';
import { smallPhotoUrl } from './LibraryPhotos.js';
import { playSound } from '../audio/Audio.js';
import './HomeScreen.css';

// How many cards each Recent tab shows.
const RECENT_ITEM_COUNT = 10;

// The Quick tools. 'photos' opens the New model dialog; the others open that page.
const START_ACTIONS = [
    { id: 'photos', title: 'Add photos', hint: 'Upload 40 to 80 overlapping photos', icon: 'upload' },
    { id: 'extractor', title: 'Frames from videos', hint: 'Pull sharp frames out of a walkaround video', icon: 'play' },
    { id: 'scene', title: 'Build a scene', hint: 'Place your models together in one scene', icon: 'cube' },
];

// The sample model "Open the sample model" opens (a sample job on the
// server, see the backend's sample-data/jobs.json).
const SAMPLE_MODEL_JOB_ID = 'sample-cat-statue';

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

function HomeScreen({ onNewModel, onNavigate, onOpenLibrary, onOpenModel }) {
    const [jobs, setJobs] = useState([]);
    // Whether the server has the sample model (sample jobs can be switched off).
    const [hasSampleModel, setHasSampleModel] = useState(false);
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

        async function checkSampleModel() {
            try {
                const res = await fetch(`/api/v1/jobs/${SAMPLE_MODEL_JOB_ID}`);
                if (!res.ok) return;
                const sample = await res.json();
                if (!isCancelled) setHasSampleModel(Boolean(sample.hasResult));
            } catch {
                // No sample: the button stays hidden.
            }
        }

        loadJobs();
        checkSampleModel();
        // Ignore the responses if the user leaves Home before they arrive.
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
            modelCoverUrl: job.cover ?? null,
            coverUrl: job.images?.[0]?.url ?? null,
            createdAt: job.createdAt,
        }));

    const isShowingFiles = recentTab === 'files';
    const recentItems = isShowingFiles ? recentFiles : recentModels;
    const hasModels = recentModels.length > 0;

    function openItem(item) {
        playSound('tap');
        if (isShowingFiles) onOpenLibrary('photos');
        else onOpenModel(item.id);
    }

    function startAction(actionId) {
        playSound('tap');
        if (actionId === 'photos') onNewModel();
        else onNavigate(actionId);
    }

    return (
        <div className="home-screen">
            <section className="home-hero" aria-labelledby="home-hero-title">
                <span className="home-hero-art" aria-hidden="true" />
                <h1 id="home-hero-title" className="home-hero-title">Get Started</h1>
                <p className="home-hero-text">
                    Start a model from photos or a video, or open a scene to arrange the models you have made.
                </p>
            </section>

            <section className="home-tools" aria-labelledby="home-tools-title">
                <h2 id="home-tools-title" className="home-section-title">Quick tools</h2>
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

            {!isLoading && !loadError && !isShowingFiles && !hasModels && (
                <div className="home-empty-state">
                    <p className="home-empty-note">No models yet. Click New to start one from photos or a video.</p>
                    <div className="home-empty-actions">
                        <button
                            type="button"
                            className="forma-btn forma-btn-primary"
                            onClick={() => {
                                playSound('tap');
                                onNewModel();
                            }}
                        >
                            Upload photos
                        </button>
                        {hasSampleModel && (
                            <button
                                type="button"
                                className="forma-btn"
                                onClick={() => {
                                    playSound('tap');
                                    onOpenModel(SAMPLE_MODEL_JOB_ID);
                                }}
                            >
                                Open the sample model
                            </button>
                        )}
                    </div>
                </div>
            )}

            {!isLoading && !loadError && isShowingFiles && recentItems.length === 0 && (
                <p className="home-recent-note">No photos yet.</p>
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
                                {isShowingFiles ? (
                                    item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy" /> : <Icon name="image" size={26} />
                                ) : (
                                    <ModelCover coverUrl={item.modelCoverUrl} photoUrl={item.coverUrl} icon="layers" />
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
        </div>
    );
}

export default HomeScreen;