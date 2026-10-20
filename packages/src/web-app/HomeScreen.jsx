/*!************************************************************************
\file HomeScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 20-10-2026
\brief
Dashboard landing screen: a personalised welcome, a "Start a new project"
banner that opens the capture flow, four tool cards (Media Library, Photo
Editor, Scene Builder, YouTube Extractor), and the most recent finished
models. Model and photo counts and the recent models come from GET /jobs;
clicking a recent model opens it in the full-page viewer.
**************************************************************************/

import { useEffect, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

const TOOLS = [
    { id: 'library', category: 'Models & photos', title: 'Media Library', description: 'Browse, organize, and manage your generated models and source photos.', icon: 'layers' },
    { id: 'editor', category: 'Enhance & prepare', title: 'Photo Editor', description: 'Crop and enhance source images before creating your model.', icon: 'edit' },
    { id: 'scene', category: '3D environment', title: 'Scene Builder', description: 'Arrange models, set lighting, and export complete 3D scenes.', icon: 'shield' },
    { id: 'youtube', category: 'Frame capture', title: 'YouTube Extractor', description: 'Capture useful source frames from any YouTube video.', icon: 'play' },
];

const BANNER_STEPS = ['Add photos', 'Refine images', 'Generate model'];

// How many finished models the "Recent models" row shows.
const RECENT_MODEL_COUNT = 4;

function pluralize(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function HomeScreen({ userName, onNewGeneration, onYoutube, onNavigate, onOpenLibrary, onOpenModel }) {
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

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

    const finishedJobs = jobs.filter((job) => job.status === 'done');
    const photoCount = jobs.reduce((total, job) => total + (job.images?.length ?? 0), 0);
    // Assumes the server lists the newest job first (same as the Library).
    const recentModels = finishedJobs.slice(0, RECENT_MODEL_COUNT);

    function getToolFooter(toolId) {
        if (toolId === 'library') {
            if (isLoading) return 'Loading...';
            if (loadError) return 'Library unavailable';
            return `${pluralize(finishedJobs.length, 'model')} - ${pluralize(photoCount, 'photo')}`;
        }
        if (toolId === 'editor') return 'Check photos before building';
        if (toolId === 'scene') return 'Preview';
        return 'Paste a link to start';
    }

    function handleToolClick(toolId) {
        playSound('click2');
        if (toolId === 'youtube') {
            onYoutube();
        } else {
            onNavigate(toolId);
        }
    }

    return (
        <div className="home-screen">
            <p className="eyebrow">Default workspace</p>
            <div className="home-heading-row">
                <div>
                    <h1>Welcome back, {userName}</h1>
                    <p className="home-subtitle">Turn photos and video frames into polished 3D assets.</p>
                </div>
                <button
                    className="forma-btn"
                    onClick={() => {
                        playSound('click');
                        onOpenLibrary('photos');
                    }}
                >
                    <Icon name="folder" size={14} /> Browse all files
                </button>
            </div>

            <div className="home-banner">
                <div className="home-banner-icon"><Icon name="sparkle" size={20} /></div>
                <div className="home-banner-copy">
                    <span className="eyebrow eyebrow-accent">Start a new project</span>
                    <h2>Create a 3D model from photos</h2>
                    <p>Prepare your images, review the result, and move straight into scene building.</p>
                </div>
                <ol className="home-banner-steps">
                    {BANNER_STEPS.map((step, index) => (
                        <li key={step}><span>{index + 1}</span>{step}</li>
                    ))}
                </ol>
                <button
                    className="home-banner-camera"
                    aria-label="Start a new generation"
                    onClick={() => {
                        playSound('click');
                        onNewGeneration();
                    }}
                >
                    <Icon name="camera" size={26} />
                </button>
            </div>

            <p className="eyebrow">Tools</p>
            <h2 className="home-section-title">What would you like to do?</h2>
            <div className="home-tool-grid">
                {TOOLS.map((tool) => (
                    <button
                        key={tool.id}
                        className="forma-card home-tool"
                        onClick={() => handleToolClick(tool.id)}
                    >
                        <div className="home-tool-top">
                            <span className={`home-tool-icon home-tool-icon-${tool.id}`}>
                                <Icon name={tool.icon} size={18} />
                            </span>
                            <span className="home-tool-arrow"><Icon name="arrow" size={14} /></span>
                        </div>
                        <span className="eyebrow">{tool.category}</span>
                        <h3>{tool.title}</h3>
                        <p>{tool.description}</p>
                        <span className="home-tool-footer">{getToolFooter(tool.id)}</span>
                    </button>
                ))}
            </div>

            <div className="home-recent-header">
                <div>
                    <p className="eyebrow">Your work</p>
                    <h2 className="home-section-title">Recent models</h2>
                </div>
                <button
                    className="home-link"
                    onClick={() => {
                        playSound('click');
                        onOpenLibrary('models');
                    }}
                >
                    View all models
                </button>
            </div>

            {isLoading && <p className="home-recent-note">Loading your models...</p>}
            {loadError && <p className="home-recent-note">Couldn't load your models: {loadError}</p>}
            {!isLoading && !loadError && recentModels.length === 0 && (
                <p className="home-recent-note">No models yet. Start a new project above to create your first one.</p>
            )}

            {recentModels.length > 0 && (
                <div className="home-recent-grid">
                    {recentModels.map((job) => {
                        const coverImage = job.images?.[0];

                        return (
                            <button
                                key={job.id}
                                type="button"
                                className="forma-card home-recent-item home-recent-button"
                                onClick={() => {
                                    playSound('click');
                                    onOpenModel(job.id);
                                }}
                            >
                                <div className="home-recent-thumb">
                                    {coverImage ? (
                                        <img src={coverImage.url} alt="" loading="lazy" />
                                    ) : (
                                        <Icon name="layers" size={22} />
                                    )}
                                </div>
                                <div>
                                    <div className="home-recent-name">Model {job.id.slice(0, 8)}</div>
                                    <div className="home-recent-poly">{pluralize(job.images?.length ?? 0, 'photo')}</div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default HomeScreen;