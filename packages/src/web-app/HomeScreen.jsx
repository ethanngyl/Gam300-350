/*!************************************************************************
\file HomeScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Dashboard landing screen: a personalised welcome, a "Start a new project"
banner that opens the capture flow, four tool cards (Media Library, Photo
Editor, Scene Builder, YouTube Extractor), and a row of recent models.
**************************************************************************/

import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

const TOOLS = [
    { id: 'library', category: 'Models & photos', title: 'Media Library', description: 'Browse, organize, and manage your generated models and source photos.', footer: '24 models - 156 photos', icon: 'layers' },
    { id: 'editor', category: 'Enhance & prepare', title: 'Photo Editor', description: 'Crop and enhance source images before creating your model.', footer: '3 edited today', icon: 'edit' },
    { id: 'scene', category: '3D environment', title: 'Scene Builder', description: 'Arrange models, set lighting, and export complete 3D scenes.', footer: '3 active scenes', icon: 'shield' },
    { id: 'youtube', category: 'Frame capture', title: 'YouTube Extractor', description: 'Capture useful source frames from any YouTube video.', footer: 'Ready to import', icon: 'play' },
];

const BANNER_STEPS = ['Add photos', 'Refine images', 'Generate model'];

const RECENT_MODELS = [
    { name: 'Ceramic Vase A', poly: '14.2k polygons', time: '2h ago' },
    { name: 'Stone Fragment', poly: '8.7k polygons', time: '5h ago' },
    { name: 'Wooden Chair', poly: '22.1k polygons', time: '1d ago' },
    { name: 'Metal Bracket', poly: '5.3k polygons', time: '2d ago' },
];

function HomeScreen({ userName, onNewGeneration, onYoutube, onNavigate, onOpenLibrary }) {
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
                        <span className="home-tool-footer">{tool.footer}</span>
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
            <div className="home-recent-grid">
                {RECENT_MODELS.map((model) => (
                    <div key={model.name} className="forma-card home-recent-item">
                        <div className="home-recent-thumb"><Icon name="layers" size={22} /></div>
                        <div>
                            <div className="home-recent-name">{model.name}</div>
                            <div className="home-recent-poly">{model.poly} - {model.time}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default HomeScreen;