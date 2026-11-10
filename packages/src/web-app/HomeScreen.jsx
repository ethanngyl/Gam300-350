/*!************************************************************************
\file HomeScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 26-10-2026
\brief
Dashboard landing screen, laid out like the Genesis wireframe and focused
on the user's own work: a welcome line and subtitle (plus a "New model"
button on phones, as a bigger target than the bottom bar's), then "Create a
3D model" with three large cards (camera capture, upload photos straight
into the capture batch, or the Frame Extractor for videos), then "Recent" with two
tabs and a "View all" button. "Your files" shows the latest photo batches and opens the Photo
Library; "Generated models" shows the latest finished models and opens one
in the full-page viewer. Both come from GET /jobs. With nothing made yet,
it shows a single "Create your first 3D model" card instead.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { jobDisplayName } from './mediaApi.js';
import { playSound } from '../audio/Audio.js';

// How many cards each Recent tab shows.
const RECENT_ITEM_COUNT = 10;

// The three ways to start a model, shown as large cards in Create.
const CREATE_OPTIONS = [
    {
        id: 'camera',
        icon: 'camera',
        title: 'Capture with camera',
        text: 'Walk around your object and shoot it from every angle.',
        hint: 'Phone or webcam',
    },
    {
        id: 'photos',
        icon: 'image',
        title: 'Upload photos',
        text: 'Use overlapping photos you already took of an object.',
        hint: 'JPG, PNG, WEBP, HEIC',
    },
    {
        id: 'video',
        icon: 'video',
        title: 'Extract from video',
        text: 'Turn a video that orbits the object into clean frames.',
        hint: 'MP4, MOV, WEBM',
    },
];

const RECENT_TABS = [
    { id: 'files', label: 'Your files' },
    { id: 'models', label: 'Generated models' },
];

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

function HomeScreen({ userName, onNewGeneration, onAddPhotos, onOpenExtractor, onOpenLibrary, onOpenModel }) {
    const photoInputRef = useRef(null);
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [recentTab, setRecentTab] = useState('files');

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
            kind: job.status === 'done' ? `Source photos \u00B7 ${job.images.length}` : 'Processing',
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
        playSound('tap');
        if (isShowingFiles) onOpenLibrary('photos');
        else onOpenModel(item.id);
    }

    function startNewModel() {
        playSound('confirm');
        onNewGeneration();
    }

    function handlePhotosChosen(event) {
        const chosenFiles = Array.from(event.target.files ?? []);
        // Clear so choosing the same files again still fires onChange.
        event.target.value = '';
        if (chosenFiles.length > 0) onAddPhotos(chosenFiles);
    }

    // A Create card was clicked (CREATE_OPTIONS ids).
    function selectCreateOption(id) {
        if (id === 'camera') {
            startNewModel();
            return;
        }
        playSound('tap');
        if (id === 'photos') photoInputRef.current?.click();
        else onOpenExtractor();
    }

    return (
        <div className="home-screen">
            <div className="home-heading-row">
                <div>
                    <p className="eyebrow eyebrow-accent">Default workspace</p>
                    <h1>Welcome back, {userName}</h1>
                    <p className="home-subtitle">Turn photos and video frames into polished 3D assets.</p>
                </div>
                {/* Phones only: a bigger New model button than the bar's icon. */}
                <button className="forma-btn forma-btn-primary home-new-model" onClick={startNewModel}>
                    <Icon name="cubePlus" size={15} /> New model
                </button>
            </div>

            <section className="home-create" aria-labelledby="home-create-title">
                <div className="home-create-header">
                    <h2 id="home-create-title" className="home-section-title">Create a 3D model</h2>
                    <p>Pick how you want to capture your object. Every option ends in the same reconstruction pipeline.</p>
                </div>
                <div className="home-create-grid">
                    {CREATE_OPTIONS.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            className={`home-create-card is-${option.id}`}
                            onClick={() => selectCreateOption(option.id)}
                        >
                            <span className="home-create-icon"><Icon name={option.icon} size={22} /></span>
                            <span className="home-create-copy">
                                <span className="home-create-title">{option.title}</span>
                                <span className="home-create-text">{option.text}</span>
                            </span>
                            <span className="home-create-foot">
                                <span className="home-create-hint">{option.hint}</span>
                                <span className="home-create-arrow"><Icon name="arrow" size={16} /></span>
                            </span>
                        </button>
                    ))}
                </div>
                <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotosChosen}
                    style={{ display: 'none' }}
                />
            </section>

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
                    className="forma-btn home-view-all"
                    onClick={() => {
                        playSound('tap');
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
                        <Icon name="cubePlus" size={14} /> New model
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
                                    <Icon name={isShowingFiles ? 'image' : 'layers'} size={13} />
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
    );
}

export default HomeScreen;