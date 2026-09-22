import { useState } from 'react';
import SplatViewer from './SplatViewer.jsx';

const TOOL_TABS = ['Curves', 'Surfaces', 'Polygon', 'Sculpt', 'UV', 'Rigging', 'Animation', 'FX', 'Custom'];

const OUTLINER = [
    { id: 'persp', label: 'persp', type: 'camera' },
    { id: 'top', label: 'top', type: 'camera' },
    { id: 'front', label: 'front', type: 'camera' },
    { id: 'side', label: 'side', type: 'camera' },
    {
        id: 'ceramic_vase_a',
        label: 'Ceramic_Vase_A',
        type: 'model',
        splatUrl: '/samples/sample_splat.ply',
        mesh: { vertices: 3204, edges: 6392, faces: 3190, triangles: 6380 },
        children: ['vase_geo', 'vase_mat'],
    },
    { id: 'stone_fragment', label: 'Stone_Fragment', type: 'model' },
    { id: 'wooden_chair', label: 'Wooden_Chair', type: 'model' },
    { id: 'defaultLightSet', label: 'defaultLightSet', type: 'light' },
];

function SceneBuilderScreen() {
    const [activeToolTab, setActiveToolTab] = useState('Polygon');
    const [activeTransformTool, setActiveTransformTool] = useState('Move');
    const [selectedId, setSelectedId] = useState('ceramic_vase_a');
    const [frame, setFrame] = useState(12);
    const [isPlaying, setIsPlaying] = useState(false);

    const selected = OUTLINER.find((item) => item.id === selectedId);

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
                        className={activeTransformTool === tool ? 'forma-btn forma-btn-primary' : 'forma-btn'}
                        onClick={() => setActiveTransformTool(tool)}
                    >
                        {tool}
                    </button>
                ))}
            </div>

            <div className="scene-body">
                <div className="scene-outliner">
                    <span className="scene-panel-label">Outliner</span>
                    {OUTLINER.map((item) => (
                        <div
                            key={item.id}
                            className={item.id === selectedId ? 'scene-outliner-item is-active' : 'scene-outliner-item'}
                            onClick={() => item.type === 'model' && setSelectedId(item.id)}
                        >
                            {item.type === 'camera' && '◎ '}
                            {item.type === 'model' && '◆ '}
                            {item.type === 'light' && '☀ '}
                            {item.label}
                        </div>
                    ))}
                </div>

                <div className="scene-viewport">
                    <span className="scene-viewport-label">persp</span>
                    {selected?.splatUrl ? (
                        <SplatViewer splatUrl={selected.splatUrl} />
                    ) : (
                        <div className="scene-viewport-placeholder">◆</div>
                    )}
                </div>

                <div className="scene-inspector">
                    <h4>Transform</h4>
                    {['Translate X', 'Translate Y', 'Translate Z', 'Rotate X', 'Rotate Y', 'Rotate Z', 'Scale X', 'Scale Y', 'Scale Z'].map((field) => (
                        <label key={field} className="scene-transform-field">
                            {field}
                            <input type="number" defaultValue={field.startsWith('Scale') ? 1 : 0} step="0.001" />
                        </label>
                    ))}

                    {selected?.mesh && (
                        <>
                            <h4>Mesh</h4>
                            <div className="scene-mesh-stats">
                                <span>Vertices <b>{selected.mesh.vertices.toLocaleString()}</b></span>
                                <span>Edges <b>{selected.mesh.edges.toLocaleString()}</b></span>
                                <span>Faces <b>{selected.mesh.faces.toLocaleString()}</b></span>
                                <span>Triangles <b>{selected.mesh.triangles.toLocaleString()}</b></span>
                            </div>
                        </>
                    )}

                    <h4>Components</h4>
                    <div className="scene-component-grid">
                        {['Extrude', 'Bevel', 'Smooth', 'Boolean', 'Bridge', 'Subdivide'].map((c) => (
                            <button key={c} className="forma-btn">{c}</button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="scene-timeline">
                <button onClick={() => setIsPlaying((p) => !p)}>{isPlaying ? '⏸' : '▶'}</button>
                <div className="scene-timeline-frames">
                    {Array.from({ length: 23 }, (_, i) => i + 1).map((n) => (
                        <button
                            key={n}
                            className={n === frame ? 'scene-frame is-active' : 'scene-frame'}
                            onClick={() => setFrame(n)}
                        >
                            {n}
                        </button>
                    ))}
                </div>
                <span className="scene-frame-count">Frame {frame} / 120</span>
            </div>
        </div>
    );
}

export default SceneBuilderScreen;