import { useState } from 'react';

const TOOLS = ['move', 'crop', 'adjust', 'grade', 'filter', 'reset'];
const HISTORY = ['Original', 'Crop', 'Brightness +10', 'Contrast +15', 'Sharpen'];

function PhotoEditorScreen({ onGenerateModel }) {
    const [activeTool, setActiveTool] = useState('adjust');
    const [activeHistory, setActiveHistory] = useState('Sharpen');

    // Real, controlled sliders -- not static mockup values.
    const [brightness, setBrightness] = useState(52);
    const [contrast, setContrast] = useState(65);
    const [saturation, setSaturation] = useState(48);
    const [sharpness, setSharpness] = useState(30);

    return (
        <div className="editor-screen">
            <div className="editor-tools">
                {TOOLS.map((tool) => (
                    <button
                        key={tool}
                        className={activeTool === tool ? 'editor-tool is-active' : 'editor-tool'}
                        onClick={() => setActiveTool(tool)}
                        title={tool}
                    >
                        {tool === 'move' && '✥'}
                        {tool === 'crop' && '⬚'}
                        {tool === 'adjust' && '✦'}
                        {tool === 'grade' && '◐'}
                        {tool === 'filter' && '▽'}
                        {tool === 'reset' && '↺'}
                    </button>
                ))}
            </div>

            <div className="editor-canvas-area">
                <div className="editor-canvas-header">
                    <span>IMG_001.jpg · 2048 × 1536 px</span>
                    <div className="editor-zoom">
                        <button className="forma-btn">50%</button>
                        <button className="forma-btn">100%</button>
                        <button className="forma-btn">Fit</button>
                    </div>
                </div>

                {/* Same corner-bracket idea as your CoDeFine hero viewfinder --
                    reused here as a crop-selection frame. */}
                <div className="editor-canvas">
                    <div className="corner-marks">
                        <span className="tl"></span><span className="tr"></span>
                        <span className="bl"></span><span className="br"></span>
                    </div>
                    <p>IMG_001.jpg loaded</p>
                </div>

                <div className="editor-history">
                    <span className="editor-history-label">History</span>
                    {HISTORY.map((step) => (
                        <button
                            key={step}
                            className={activeHistory === step ? 'editor-history-step is-active' : 'editor-history-step'}
                            onClick={() => setActiveHistory(step)}
                        >
                            {step}
                        </button>
                    ))}
                </div>
            </div>

            <div className="editor-panel">
                <h4>Adjustments</h4>

                <label className="editor-slider">
                    <span>Brightness <b>{brightness}</b></span>
                    <input type="range" min="0" max="100" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />
                </label>
                <label className="editor-slider">
                    <span>Contrast <b>{contrast}</b></span>
                    <input type="range" min="0" max="100" value={contrast} onChange={(e) => setContrast(Number(e.target.value))} />
                </label>
                <label className="editor-slider">
                    <span>Saturation <b>{saturation}</b></span>
                    <input type="range" min="0" max="100" value={saturation} onChange={(e) => setSaturation(Number(e.target.value))} />
                </label>
                <label className="editor-slider">
                    <span>Sharpness <b>{sharpness}</b></span>
                    <input type="range" min="0" max="100" value={sharpness} onChange={(e) => setSharpness(Number(e.target.value))} />
                </label>

                <h4>Color Grading</h4>
                <div className="editor-grade-grid">
                    <button className="forma-btn">Highlights</button>
                    <button className="forma-btn">Shadows</button>
                    <button className="forma-btn">Midtones</button>
                    <button className="forma-btn">Whites</button>
                </div>

                <h4>Lens Correction</h4>
                <div className="editor-toggles">
                    {['Distortion', 'Vignette', 'Chromatic Aberration'].map((label) => (
                        <label key={label} className="editor-toggle-row">
                            {label}
                            <input type="checkbox" />
                        </label>
                    ))}
                </div>

                <button className="forma-btn forma-btn-primary editor-generate" onClick={onGenerateModel}>
                    ✦ Generate 3D Model
                </button>
                <button className="forma-btn">Save to Library</button>
            </div>
        </div>
    );
}

export default PhotoEditorScreen;