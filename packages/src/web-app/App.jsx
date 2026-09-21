import { useState } from 'react';
import CameraCapture from './CameraCapture.jsx';
import Processing from './Processing.jsx';
import SplatViewer from './SplatViewer.jsx';
import YoutubeIngest from './YoutubeIngest.jsx';
import ImageGallery from './ImageGallery.jsx';
import TopNav from './TopNav.jsx';
import HomeScreen from './HomeScreen.jsx';
import LibraryScreen from './LibraryScreen.jsx';
import PhotoEditorScreen from './PhotoEditorScreen.jsx';
import SceneBuilderScreen from './SceneBuilderScreen.jsx';
import './AppTheme.css';
import './App.css';

function App() {
    // Which dashboard tab is showing (Home / Library / Photo Editor / Scene Builder).
    const [activeTab, setActiveTab] = useState('home');

    // Full-page flows that temporarily replace the whole dashboard.
    // null means "show the normal dashboard". Otherwise one of:
    // 'capture' | 'processing' | 'result' | 'youtube'
    const [screen, setScreen] = useState(null);
    const [jobId, setJobId] = useState(null);
    const [uploadError, setUploadError] = useState(null);

    // Uploads the real batch to the backend and starts reconstruction.
    async function handleBatchReady(files) {
        setUploadError(null);
        try {
            const form = new FormData();
            for (const file of files) form.append('images', file);
            const res = await fetch('/upload', { method: 'POST', body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            setJobId(data.id);
            //setScreen('processing');
        } catch (err) {
            setUploadError(err.message);
        }
    }

    function backToDashboard() {
        setScreen(null);
    }

    function resetJob() {
        setJobId(null);
        setUploadError(null);
        setScreen(null);
    }

    if (screen === 'capture') {
        return (
            <>
                {uploadError && (
                    <p className="capture-error" style={{ textAlign: 'center' }}>{uploadError}</p>
                )}
                <CameraCapture onBatchReady={handleBatchReady} onBack={backToDashboard} />
            </>
        );
    }

    if (screen === 'processing' && jobId) {
        return (
            <Processing
                jobId={jobId}
                onDone={() => setScreen('result')}
                onCancel={resetJob}
            />
        );
    }

    if (screen === 'result' && jobId) {
        // SplatViewer renders itself full-page (position: fixed, inset: 0),
        // so it is only ever used here as a standalone screen, never
        // embedded inside the tabbed dashboard layout.
        return (
            <>
                <SplatViewer url={`/jobs/${jobId}/result.ply`} />
                <div style={{ position: 'fixed', top: 16, left: 16, display: 'flex', gap: 10, zIndex: 10 }}>
                    <button className="btn btn-primary" onClick={resetJob}>
                        New scan
                    </button>
                    <a className="btn btn-ghost" href={`/jobs/${jobId}/result.ply`} download="model.ply">
                        Download .ply
                    </a>
                    <button className="btn btn-ghost" onClick={backToDashboard}>
                        Back to dashboard
                    </button>
                </div>
            </>
        );
    }

    if (screen === 'gallery') {
        return <ImageGallery onBack={backToDashboard} />;
    }

        /*return (
            <>
                <header className="nav">
                    <div className="wrap">
                        <div className="logo">Co<span>De</span>Fine</div>
                        <ul className="nav-links">
                            <li><a href="#workflow">How it works</a></li>
                            <li><a href="#youtube">From a video</a></li>
                            <li><a href="#builder">Scene builder</a></li>
                            <li><a href="#get-started">Get started</a></li>
                        </ul>
                        <button
                            className="btn btn-ghost"
                            onClick={() => setScreen('gallery')}
                        >
                            Gallery
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={() => setScreen('capture')}
                        >
                            Start scanning
                        </button>
                    </div>
                </header>

                <main>
                    <section className="hero">
                        <div className="wrap">
                            <div className="hero-copy">
                                <h1>Point your phone at it. Get a 3D model back.</h1>
                                <p>
                                    CoDeFine turns photos of a real object into a clean 3D mesh,
                                    then drops it straight into a scene builder - so you can pose,
                                    light, and arrange your scans without leaving the browser.
                                </p>
                                <div className="hero-actions">
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => setScreen('capture')}
                                    >
                                        Start scanning
                                    </button>
                                    <a href="#workflow" className="btn btn-ghost">See how it works</a>
                                </div>
                                <div className="hero-note">
                                    <span className="dot"></span>
                                    Works from any phone camera - no scanner hardware needed
                                </div>
                            </div>

                            <div className="viewfinder" aria-hidden="true">
                                <div className="corner-marks">
                                    <span className="tl"></span>
                                    <span className="tr"></span>
                                    <span className="bl"></span>
                                    <span className="br"></span>
                                </div>
                                <div className="scan-tag">mesh_preview</div>
                                <div className="cube-stage">
                                    <div className="cube">
                                        <div className="cube-face front"></div>
                                        <div className="cube-face back"></div>
                                        <div className="cube-face right"></div>
                                        <div className="cube-face left"></div>
                                        <div className="cube-face top"></div>
                                        <div className="cube-face bottom"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section id="workflow">
                        <div className="wrap">
                            <div className="section-head">
                                <h2>From object to asset in three passes</h2>
                                <p>Each scan moves through the same pipeline, whether it's a coffee mug or a prop for your next project.</p>
                            </div>

                            <ol className="workflow-list">
                                <li className="workflow-item">
                                    <div className="workflow-num">01</div>
                                    <div>
                                        <h3>Capture</h3>
                                        <p>Walk around the object with your phone. CoDeFine guides you through the angles it still needs as you go.</p>
                                    </div>
                                    <div className="workflow-detail">No tripod or special lighting rig required - ust steady hands and even light.</div>
                                </li>
                                <li className="workflow-item">
                                    <div className="workflow-num">02</div>
                                    <div>
                                        <h3>Reconstruct</h3>
                                        <p>Your photos are stitched into a textured mesh on our servers, and cleaned up automatically for stray geometry.</p>
                                    </div>
                                    <div className="workflow-detail">Most everyday objects finish processing in a few minutes.</div>
                                </li>
                                <li className="workflow-item">
                                    <div className="workflow-num">03</div>
                                    <div>
                                        <h3>Place</h3>
                                        <p>The finished model lands in your library, ready to drag into the scene builder or export for another project.</p>
                                    </div>
                                    <div className="workflow-detail">Exports as .glb, so it travels well outside CoDeFine too.</div>
                                </li>
                            </ol>
                        </div>
                    </section>

                    <section id="youtube">
                        <div className="wrap">
                            <div className="section-head">
                                <h2>Already have a video? Build from a YouTube link</h2>
                                <p>Paste a link to a video that orbits the object. We extract evenly spaced frames and run them through the same reconstruction pipeline - no phone capture needed.</p>
                            </div>
                            <YoutubeIngest />
                        </div>
                    </section>

                    <section id="builder">
                        <div className="wrap">
                            <div className="section-head">
                                <h2>Arrange your scans in the scene builder</h2>
                                <p>Every model you capture shows up in one library. Pull pieces into a scene, and adjust position, scale, and rotation directly in the viewport.</p>
                            </div>

                            <div className="builder-panel">
                                <div className="builder-bar">
                                    <div className="dots"><i></i><i></i><i></i></div>
                                    <div className="filename">desk-setup.scene</div>
                                </div>
                                <div className="builder-body">
                                    <div className="builder-sidebar">
                                        <h4>your models</h4>

                                        {MODELS.map((model) => (
                                            <button
                                                key={model}
                                                className={
                                                    model === activeModel
                                                        ? 'model-chip is-active'
                                                        : 'model-chip'
                                                }
                                                onClick={() => setActiveModel(model)}
                                            >
                                                <span className="swatch"></span>
                                                {model}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="builder-viewport">
                                        <div className="viewport-object"></div>
                                        <div className="viewport-toolbar" aria-hidden="true">
                                            {TOOLS.map((tool) => (
                                                <button
                                                    key={tool}
                                                    className={tool === activeTool ? 'on' : ''}
                                                    title={tool}
                                                    onClick={() => setActiveTool(tool)}
                                                ></button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="final-cta" id="get-started">
                        <div className="wrap">
                            <h2>Your first scan takes about five minutes.</h2>
                            <div className="actions">
                                <button
                                    className="btn btn-primary"
                                    onClick={() => setScreen('capture')}
                                >
                                    Start scanning
                                </button>
                                <a href="#" className="btn btn-ghost">Read the docs</a>
                            </div>
                        </div>
                    </section>
                </main>

                <footer>
                    <div className="wrap">
                        <div>CoDeFine</div>
                        <ul>
                            <li><a href="#workflow">How it works</a></li>
                            <li><a href="#builder">Scene builder</a></li>
                            <li><a href="#">GitHub</a></li>
                        </ul>
                    </div>
                </footer>
            </>
        )*/

    if (screen === 'youtube') {
        return (
            <div style={{ minHeight: '100vh', background: '#0f1115', color: '#e8eaed', padding: 24 }}>
                <button className="btn btn-ghost" onClick={backToDashboard} style={{ marginBottom: 20 }}>
                    Back to dashboard
                </button>
                <YoutubeIngest />
            </div>
        );
    }

    return (
        <div className="forma-app">
            <TopNav activeTab={activeTab} onTabChange={setActiveTab} />

            {activeTab === 'home' && (
                <HomeScreen
                    onNewGeneration={() => setScreen('capture')}
                    onYoutube={() => setScreen('youtube')}
                    onGallery={() => setScreen('gallery')}
                    onNavigate={setActiveTab}
                />
            )}
            {activeTab === 'library' && (
                <LibraryScreen
                    onGenerateModel={() => setScreen('capture')}
                    onUploadPhotos={() => setScreen('capture')}
                />
            )}
            {activeTab === 'editor' && (
                <PhotoEditorScreen onGenerateModel={() => setScreen('capture')} />
            )}
            {activeTab === 'scene' && <SceneBuilderScreen />}
        </div>
    );
}

export default App;