/*!************************************************************************
\file SceneBuilderScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Maya-style scene builder screen: tool-category tabs, transform tool bar,
a searchable outliner (cameras, models with expandable children, lights),
a viewport with menu bar, view cube, selection handles and axis legend, an
Object / Help inspector (collapsible Transform, Mesh and Components
sections), and a frame timeline with transport controls. Currently a
static mockup; the splat preview was removed from the viewport because
SplatViewer renders full-page and blocked the rest of the UI.
**************************************************************************/

import { useState } from 'react';
import Icon from './Icons.jsx';

const TOOL_TABS = ['Curves', 'Surfaces', 'Polygon', 'Sculpt', 'UV', 'Rigging', 'Animation', 'Rendering', 'FX', 'Custom'];
const VIEWPORT_MENUS = ['View', 'Shading', 'Lighting', 'Show', 'Renderer', 'Panels'];
const TRANSFORM_FIELDS = ['Translate X', 'Translate Y', 'Translate Z', 'Rotate X', 'Rotate Y', 'Rotate Z', 'Scale X', 'Scale Y', 'Scale Z'];
const COMPONENT_BUTTONS = ['Extrude', 'Bevel', 'Smooth', 'Boolean', 'Bridge', 'Subdivide'];
const SELECTION_HANDLES = [[0, 0], [50, 0], [100, 0], [0, 50], [100, 50], [0, 100], [50, 100], [100, 100]];
const FRAME_NUMBERS = Array.from({ length: 23 }, (_, index) => index + 1);

const OUTLINER = [
    { id: 'persp', label: 'persp', type: 'camera' },
    { id: 'top', label: 'top', type: 'camera' },
    { id: 'front', label: 'front', type: 'camera' },
    { id: 'side', label: 'side', type: 'camera' },
    {
        id: 'ceramic_vase_a',
        label: 'Ceramic_Vase_A',
        type: 'model',
        mesh: { vertices: 3204, edges: 6392, faces: 3190, triangles: 6380 },
        children: [
            { id: 'vase_geo', label: 'vase_geo', type: 'geometry' },
            { id: 'vase_mat', label: 'vase_mat', type: 'material' },
        ],
    },
    { id: 'stone_fragment', label: 'Stone_Fragment', type: 'model' },
    { id: 'wooden_chair', label: 'Wooden_Chair', type: 'model' },
    { id: 'defaultLightSet', label: 'defaultLightSet', type: 'light' },
];

const OUTLINER_ICONS = {
    camera: 'eye',
    model: 'layers',
    geometry: 'triangle',
    material: 'target',
    light: 'sun',
};

function SceneBuilderScreen({ onAddFromLibrary }) {
    const [activeToolTab, setActiveToolTab] = useState('Polygon');
    const [activeTransformTool, setActiveTransformTool] = useState('Move');
    const [selectedId, setSelectedId] = useState('ceramic_vase_a');
    const [expandedIds, setExpandedIds] = useState(['ceramic_vase_a']);
    const [outlinerSearch, setOutlinerSearch] = useState('');
    const [inspectorTab, setInspectorTab] = useState('Object');
    const [openSections, setOpenSections] = useState({ transform: true, mesh: true, components: true });
    const [frame, setFrame] = useState(12);
    const [isPlaying, setIsPlaying] = useState(false);

    const selected = OUTLINER.find((item) => item.id === selectedId);
    const normalizedSearch = outlinerSearch.trim().toLowerCase();
    const visibleItems = OUTLINER.filter((item) => item.label.toLowerCase().includes(normalizedSearch));

    function toggleExpanded(itemId) {
        setExpandedIds((current) =>
            current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
        );
    }

    function toggleSection(sectionName) {
        setOpenSections((current) => ({ ...current, [sectionName]: !current[sectionName] }));
    }

    return (
        <div className="scene-screen">
            <div className="scene-tool-tabs">
                {TOOL_TABS.map((tab) => (
                    <button
                        key={tab}
                        className={activeToolTab === tab ? 'scene-tool-tab is-active' : 'scene-tool-tab'}
                        onClick={() => setActiveToolTab(tab)}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            <div className="scene-transform-bar">
                {['Move', 'Rotate', 'Scale'].map((tool) => (
                    <button
                        key={tool}
                        className={activeTransformTool === tool ? 'scene-chip is-active' : 'scene-chip'}
                        onClick={() => setActiveTransformTool(tool)}
                    >
                        {tool}
                    </button>
                ))}
                <span className="scene-color-space">ACES 1.0 - SDR</span>
            </div>

            <div className="scene-body">
                <div className="scene-outliner">
                    <span className="scene-panel-title">Outliner</span>
                    <div className="scene-outliner-menu"><span>Display</span><span>Show</span><span>Help</span></div>
                    <input
                        className="scene-outliner-search"
                        placeholder="Search..."
                        value={outlinerSearch}
                        onChange={(event) => setOutlinerSearch(event.target.value)}
                    />

                    <div className="scene-outliner-list">
                        {visibleItems.map((item) => (
                            <div key={item.id}>
                                <div
                                    className={item.id === selectedId ? 'scene-outliner-item is-active' : 'scene-outliner-item'}
                                    onClick={() => item.type === 'model' && setSelectedId(item.id)}
                                >
                                    {item.children ? (
                                        <button
                                            className="scene-outliner-toggle"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                toggleExpanded(item.id);
                                            }}
                                            aria-label="Expand or collapse"
                                        >
                                            <Icon name="chevron" size={11} />
                                        </button>
                                    ) : (
                                        <span className="scene-outliner-toggle"></span>
                                    )}
                                    <Icon name={OUTLINER_ICONS[item.type]} size={13} />
                                    {item.label}
                                </div>
                                {item.children && expandedIds.includes(item.id) &&
                                    item.children.map((child) => (
                                        <div key={child.id} className="scene-outliner-item scene-outliner-child">
                                            <Icon name={OUTLINER_ICONS[child.type]} size={12} />
                                            {child.label}
                                        </div>
                                    ))}
                            </div>
                        ))}
                    </div>

                    <button className="scene-add-library" onClick={onAddFromLibrary}>
                        <Icon name="plus" size={12} /> Add from Library
                    </button>
                </div>

                <div className="scene-viewport">
                    <div className="scene-viewport-menu">
                        {VIEWPORT_MENUS.map((menuName) => <span key={menuName}>{menuName}</span>)}
                        <span className="scene-viewport-label">persp</span>
                    </div>

                    <div className="scene-view-cube"><span>TOP</span><span>FRONT</span></div>

                    <div className="scene-selection">
                        {SELECTION_HANDLES.map(([left, top]) => (
                            <span
                                key={`${left}-${top}`}
                                className="scene-handle"
                                style={{ left: `${left}%`, top: `${top}%` }}
                            ></span>
                        ))}
                        <Icon name="layers" size={44} />
                    </div>

                    <div className="scene-axes">
                        <span className="scene-axis-x">X</span>
                        <span className="scene-axis-y">Y</span>
                        <span className="scene-axis-z">Z</span>
                    </div>
                    <button className="scene-front-button">FRONT</button>
                </div>

                <div className="scene-inspector">
                    <div className="scene-inspector-tabs">
                        {['Object', 'Help'].map((tabName) => (
                            <button
                                key={tabName}
                                className={inspectorTab === tabName ? 'is-active' : ''}
                                onClick={() => setInspectorTab(tabName)}
                            >
                                {tabName}
                            </button>
                        ))}
                    </div>

                    {inspectorTab === 'Help' ? (
                        <p className="scene-help">
                            Select a model in the outliner to edit its transform. Use Add from
                            Library to bring scanned models into the scene.
                        </p>
                    ) : (
                        <>
                            <button className="scene-section-head" onClick={() => toggleSection('transform')}>
                                <Icon name="chevron" size={12} /> Transform
                            </button>
                            {openSections.transform && TRANSFORM_FIELDS.map((field) => (
                                <label key={`${selectedId}-${field}`} className="scene-transform-field">
                                    {field}
                                    <input type="number" defaultValue={field.startsWith('Scale') ? 1 : 0} step="0.001" />
                                </label>
                            ))}

                            {selected?.mesh && (
                                <>
                                    <button className="scene-section-head" onClick={() => toggleSection('mesh')}>
                                        <Icon name="chevron" size={12} /> Mesh
                                    </button>
                                    {openSections.mesh && (
                                        <div className="scene-mesh-stats">
                                            <span>Vertices <b>{selected.mesh.vertices.toLocaleString()}</b></span>
                                            <span>Edges <b>{selected.mesh.edges.toLocaleString()}</b></span>
                                            <span>Faces <b>{selected.mesh.faces.toLocaleString()}</b></span>
                                            <span>Triangles <b>{selected.mesh.triangles.toLocaleString()}</b></span>
                                        </div>
                                    )}
                                </>
                            )}

                            <button className="scene-section-head" onClick={() => toggleSection('components')}>
                                <Icon name="chevron" size={12} /> Components
                            </button>
                            {openSections.components && (
                                <div className="scene-component-grid">
                                    {COMPONENT_BUTTONS.map((componentName) => (
                                        <button key={componentName} className="scene-chip">{componentName}</button>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            <div className="scene-timeline">
                <div className="scene-timeline-frames">
                    {FRAME_NUMBERS.map((frameNumber) => (
                        <button
                            key={frameNumber}
                            className={frameNumber === frame ? 'scene-frame is-active' : 'scene-frame'}
                            onClick={() => setFrame(frameNumber)}
                        >
                            {frameNumber}
                        </button>
                    ))}
                </div>
                <div className="scene-transport">
                    <button onClick={() => setFrame(1)} aria-label="First frame"><Icon name="skipBack" size={14} /></button>
                    <button onClick={() => setFrame((current) => Math.max(1, current - 1))} aria-label="Previous frame"><Icon name="stepBack" size={14} /></button>
                    <button onClick={() => setIsPlaying((wasPlaying) => !wasPlaying)} aria-label="Play or pause">
                        <Icon name={isPlaying ? 'pause' : 'playSolid'} size={14} />
                    </button>
                    <button onClick={() => setFrame((current) => Math.min(120, current + 1))} aria-label="Next frame"><Icon name="stepForward" size={14} /></button>
                    <button onClick={() => setFrame(23)} aria-label="Last visible frame"><Icon name="skipForward" size={14} /></button>
                    <button aria-label="Loop"><Icon name="refresh" size={14} /></button>
                    <span className="scene-frame-count">Frame {frame} / 120</span>
                </div>
            </div>
        </div>
    );
}

export default SceneBuilderScreen;