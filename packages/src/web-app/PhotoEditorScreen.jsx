/*!************************************************************************
\file PhotoEditorScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Photo editing screen: tool rail, rulers, image canvas, zoom controls, edit
history strip, and an adjustments panel (brightness, contrast, saturation,
sharpness, color grading, lens correction) feeding into a "Generate 3D
Model" action. Currently a mockup with no real image processing.
**************************************************************************/

import { useState } from 'react';
import Icon from './Icons.jsx';

const TOOLS = [
    { id: 'move', icon: 'move' },
    { id: 'crop', icon: 'crop' },
    { id: 'adjust', icon: 'wand' },
    { id: 'grade', icon: 'moon' },
    { id: 'filter', icon: 'filter' },
    { id: 'reset', icon: 'refresh' },
];

const HISTORY = ['Original', 'Crop', 'Brightness +10', 'Contrast +15', 'Sharpen'];
const GRADES = [
    { name: 'Highlights', level: 35 },
    { name: 'Shadows', level: 55 },
    { name: 'Midtones', level: 30 },
    { name: 'Whites', level: 75 },
];
const ZOOM_LEVELS = ['50%', '100%', 'Fit'];
const RULER_X_MARKS = Array.from({ length: 20 }, (_, index) => index * 100);
const RULER_Y_MARKS = Array.from({ length: 10 }, (_, index) => index * 100);

function PhotoEditorScreen({ onGenerateModel }) {
    const [activeTool, setActiveTool] = useState('adjust');
    const [activeHistory, setActiveHistory] = useState('Sharpen');
    const [activeZoom, setActiveZoom] = useState('Fit');
    const [activeGrade, setActiveGrade] = useState(null);

    const [brightness, setBrightness] = useState(52);
    const [contrast, setContrast] = useState(65);
    const [saturation, setSaturation] = useState(48);
    const [sharpness, setSharpness] = useState(30);

    const sliders = [
        { label: 'Brightness', value: brightness, setValue: setBrightness },
        { label: 'Contrast', value: contrast, setValue: setContrast },
        { label: 'Saturation', value: saturation, setValue: setSaturation },
        { label: 'Sharpness', value: sharpness, setValue: setSharpness },
    ];

    return (
        <div className="editor-screen">
            <div className="editor-tools">
                {TOOLS.map((tool) => (
                    <button
                        key={tool.id}
                        className={activeTool === tool.id ? 'editor-tool is-active' : 'editor-tool'}
                        onClick={() => setActiveTool(tool.id)}
                        title={tool.id}
                    >
                        <Icon name={tool.icon} size={16} />
                    </button>
                ))}
                <button className="editor-tool editor-tool-settings" title="settings">
                    <Icon name="settings" size={16} />
                </button>
            </div>

            <div className="editor-canvas-area">
                <div className="editor-canvas-header">
                    <span>IMG_001.jpg</span>
                    <span className="editor-dim">2048 x 1536 px</span>
                    <div className="editor-zoom">
                        {ZOOM_LEVELS.map((zoomLevel) => (
                            <button
                                key={zoomLevel}
                                className={activeZoom === zoomLevel ? 'is-active' : ''}
                                onClick={() => setActiveZoom(zoomLevel)}
                            >
                                {zoomLevel}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="editor-ruler editor-ruler-x">
                    {RULER_X_MARKS.map((mark) => <span key={mark}>{mark}</span>)}
                </div>

                <div className="editor-canvas-row">
                    <div className="editor-ruler editor-ruler-y">
                        {RULER_Y_MARKS.map((mark) => <span key={mark}>{mark}</span>)}
                    </div>
                    <div className="editor-canvas">
                        <div className="editor-frame">
                            <span className="editor-corner editor-corner-tl"></span>
                            <span className="editor-corner editor-corner-tr"></span>
                            <span className="editor-corner editor-corner-bl"></span>
                            <span className="editor-corner editor-corner-br"></span>
                            <Icon name="image" size={38} />
                            <p>IMG_001.jpg loaded</p>
                        </div>
                    </div>
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
                {sliders.map((slider) => (
                    <label key={slider.label} className="editor-slider">
                        <span>{slider.label} <b>{slider.value}</b></span>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={slider.value}
                            onChange={(event) => slider.setValue(Number(event.target.value))}
                        />
                    </label>
                ))}

                <h4>Color Grading</h4>
                <div className="editor-grade-grid">
                    {GRADES.map((grade) => (
                        <button
                            key={grade.name}
                            className={activeGrade === grade.name ? 'editor-grade-tile is-active' : 'editor-grade-tile'}
                            onClick={() => setActiveGrade(grade.name)}
                        >
                            {grade.name}
                            <span className="editor-grade-bar">
                                <span style={{ width: `${grade.level}%` }}></span>
                            </span>
                        </button>
                    ))}
                </div>

                <h4>Lens Correction</h4>
                <div className="editor-toggles">
                    {['Distortion', 'Vignette', 'Chromatic Aberration'].map((label) => (
                        <label key={label} className="editor-toggle-row">
                            {label}
                            <input type="checkbox" className="switch" />
                        </label>
                    ))}
                </div>

                <div className="editor-actions">
                    <button className="forma-btn">
                        <Icon name="settings" size={14} /> Save Settings as Preset...
                    </button>
                    <button className="forma-btn forma-btn-primary" onClick={onGenerateModel}>
                        <Icon name="sparkle" size={14} /> Generate 3D Model
                    </button>
                    <button className="forma-btn">Save to Library</button>
                </div>
            </div>
        </div>
    );
}

export default PhotoEditorScreen;