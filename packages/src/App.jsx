import { useState } from 'react';
import './App.css';

const MODELS = ['ceramic mug', 'desk lamp', 'notebook', 'plant pot'];

const TOOLS = ['move', 'rotate', 'scale', 'delete'];

function App() {
    // useState gives this component "memory" that persists between
    // renders. Every time it changes, React automatically re-draws
    // whatever part of the page depends on it.

    // Tracks which model in the sidebar is currently selected.
    // Starts on 'ceramic mug'
    const [activeModel, setActiveModel] = useState('ceramic mug');

    // Tracks which toolbar tool is active in the viewport mockup.
    const [activeTool, setActiveTool] = useState('move');

    return (
        <>
            <header className="nav">
                <div className="wrap">
                    <div className="logo">Co<span>De</span>Fine</div>
                    <ul className="nav-links">
                        <li><a href="#workflow">How it works</a></li>
                        <li><a href="#builder">Scene builder</a></li>
                        <li><a href="#get-started">Get started</a></li>
                    </ul>
                    <a href="#get-started" className="btn btn-primary nav-cta">Start scanning</a>
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
                                <a href="#get-started" className="btn btn-primary">Start scanning</a>
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
                            <a href="#" className="btn btn-primary">Start scanning</a>
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
    );
}

export default App;
