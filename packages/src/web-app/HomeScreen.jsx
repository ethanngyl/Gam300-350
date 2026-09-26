const STATS = [
    { value: '24', label: 'Models Generated', note: '+3 this week' },
    { value: '156', label: 'Photos Uploaded', note: '+18 this week' },
    { value: '3', label: 'Active Scenes', note: 'Last edited today' },
    { value: '2', label: 'Processing Queue', note: 'Est. 4 min' },
];

const RECENT_MODELS = [
    { name: 'Ceramic Vase A', poly: '14.2k polygons', time: '2h ago' },
    { name: 'Stone Fragment', poly: '8.7k polygons', time: '5h ago' },
    { name: 'Wooden Chair', poly: '22.1k polygons', time: '1d ago' },
    { name: 'Metal Bracket', poly: '5.3k polygons', time: '2d ago' },
];

function HomeScreen({ onNewGeneration, onYoutube, onGallery, onNavigate }) {
    return (
        <div className="home-screen">
            <div className="home-hero">
                <div>
                    <h1>3D Generation Studio</h1>
                    <p>
                        Upload photos, refine them in the editor, then generate photorealistic
                        3D models. Build complete scenes and extract frames from video sources.
                    </p>
                </div>
                <button className="forma-btn forma-btn-primary" onClick={onNewGeneration}>
                    New Generation
                </button>
            </div>

            <div className="home-stats">
                {STATS.map((stat) => (
                    <div key={stat.label} className="home-stat">
                        <div className="home-stat-value">{stat.value}</div>
                        <div className="home-stat-label">{stat.label}</div>
                        <div className="home-stat-note">{stat.note}</div>
                    </div>
                ))}
            </div>

            <div className="home-body">
                <div className="home-features">
                    <h2 className="home-section-label">Features</h2>
                    <div className="home-feature-grid">
                        <button className="forma-card home-feature" onClick={() => onNavigate('library')}>
                            <h3>Media Library</h3>
                            <p>Browse your generated 3D models and organized photo collections.</p>
                            <span className="home-feature-footer">24 models - 156 photos</span>
                        </button>

                        <button className="forma-card home-feature" onClick={() => onNavigate('editor')}>
                            <h3>Photo Editor</h3>
                            <p>Adjust, crop, and enhance uploaded images to maximize accuracy.</p>
                            <span className="home-feature-footer">12 in queue - 3 edited</span>
                        </button>

                        {/*<button className="forma-card home-feature" onClick={() => onNavigate('scene')}>*/}
                        {/*    <h3>Scene Builder</h3>*/}
                        {/*    <p>Arrange and interact with your generated models in a full 3D workspace.</p>*/}
                        {/*    <span className="home-feature-footer">3 scenes - Active</span>*/}
                        {/*</button>*/}

                        <button className="forma-card home-feature" onClick={onYoutube}>
                            <h3>YouTube Extractor</h3>
                            <p>Paste a YouTube URL to process any video and extract specific frames into your photo library.</p>
                            <span className="home-feature-footer">Ready</span>
                        </button>

                        <button className="forma-card home-feature" onClick={onGallery}>
                            <h3>Image Gallery</h3>
                            <p>Browse the photos you've uploaded and download them to your computer.</p>
                            <span className="home-feature-footer">Uploaded photos</span>
                        </button>
                    </div>
                </div>

                <aside className="home-sidebar">
                    <h2 className="home-section-label">Recent Models</h2>
                    <div className="forma-card home-recent-list">
                        {RECENT_MODELS.map((model) => (
                            <div key={model.name} className="home-recent-item">
                                <div className="forma-thumb home-recent-thumb"></div>
                                <div>
                                    <div className="home-recent-name">{model.name}</div>
                                    <div className="home-recent-poly">{model.poly}</div>
                                </div>
                                <span className="home-recent-time">{model.time}</span>
                            </div>
                        ))}
                    </div>

                    <button className="home-dropzone" onClick={onNewGeneration}>
                        <p>Drop images to upload</p>
                        <span className="home-dropzone-types">JPG - PNG - WEBP - HEIC</span>
                    </button>
                </aside>
            </div>
        </div>
    );
}

export default HomeScreen;