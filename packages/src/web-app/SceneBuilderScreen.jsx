/*!************************************************************************
\file SceneBuilderScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Maya-style scene builder screen: tool-category tabs, transform tool bar,
a searchable outliner of the models in the scene, a live multi-splat
viewport (SceneViewport.jsx), an Object / Help inspector (collapsible
Transform, Splats and Object sections), and a frame timeline with
transport controls. The scene's objects are owned by the parent (App) so
the scene survives switching tabs; this screen edits them through
onObjectsChange(updater, { mergeKey }) (see useUndoableState.js). Every
edit can be undone with Ctrl+Z (or the Undo button); typing in one
transform field is one undo step.
Load progress (splat count, errors) is kept apart from the objects so
undo never brings back a stale status. "Add from Library" opens a picker
of the user's finished models from GET /jobs; the same model can be
added more than once. Move / Rotate / Scale (or 1 / 2 / 3) pick the
viewport gizmo's mode; each gizmo drag, and each held W/A/S/D key, is
one undo step. The tool tabs
and timeline are still a static mockup.
- createSceneObject(model, objects)
Private helper. A new scene object for a finished model, placed at the
origin, named after the model (numbered if it is already in the scene).
- isTextEntry(target)
Private helper. True for fields where Ctrl+Z should undo the typing
(search boxes) rather than the scene.
- TransformField({ label, value, step, onCommit })
Private component. Number input that keeps the user's partial text
(e.g. "-") while typing and commits every value that parses, with an id
for the current focus so one round of typing merges into one undo step.
- OutlinerContextMenu({ x, y, onDelete, onClose })
Private component. Menu shown where an outliner row was right-clicked,
with Delete (undoable with Ctrl+Z). Closes on a click outside, Esc,
scrolling or resizing.
- LibraryPicker({ onPick, onClose })
Private component. Searchable list of the user's finished models.
**************************************************************************/

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import SceneViewport from './SceneViewport.jsx';
import { jobDisplayName } from './mediaApi.js';
import { playSound } from '../audio/Audio.js';

const TOOL_TABS = ['Curves', 'Surfaces', 'Polygon', 'Sculpt', 'UV', 'Rigging', 'Animation', 'Rendering', 'FX', 'Custom'];
const VIEWPORT_MENUS = ['View', 'Shading', 'Lighting', 'Show', 'Renderer', 'Panels'];
// Transform tool buttons: TransformControls mode and keyboard shortcut.
const TRANSFORM_TOOLS = [
    { name: 'Move', mode: 'translate', shortcut: '1' },
    { name: 'Rotate', mode: 'rotate', shortcut: '2' },
    { name: 'Scale', mode: 'scale', shortcut: '3' },
];
const TRANSFORM_FIELDS = [
    { label: 'Translate X', key: 'position', axis: 0, step: 0.1 },
    { label: 'Translate Y', key: 'position', axis: 1, step: 0.1 },
    { label: 'Translate Z', key: 'position', axis: 2, step: 0.1 },
    { label: 'Rotate X', key: 'rotation', axis: 0, step: 5 },
    { label: 'Rotate Y', key: 'rotation', axis: 1, step: 5 },
    { label: 'Rotate Z', key: 'rotation', axis: 2, step: 5 },
    { label: 'Scale X', key: 'scale', axis: 0, step: 0.1 },
    { label: 'Scale Y', key: 'scale', axis: 1, step: 0.1 },
    { label: 'Scale Z', key: 'scale', axis: 2, step: 0.1 },
];
const DEFAULT_TRANSFORM = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
const FRAME_NUMBERS = Array.from({ length: 23 }, (_, index) => index + 1);

function createSceneObject(model, objects) {
    const copies = objects.filter((object) => object.jobId === model.id).length;
    return {
        // Not crypto.randomUUID: that needs HTTPS, and the app is also opened over plain LAN http.
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        jobId: model.id,
        name: copies === 0 ? model.name : `${model.name} (${copies + 1})`,
        url: `/jobs/${model.id}/result.ply`,
        ...DEFAULT_TRANSFORM,
        visible: true,
    };
}

function isTextEntry(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
    return target.tagName === 'INPUT' && target.type !== 'number';
}

// Counts focus sessions across every TransformField, so two separate
// rounds of typing never share an undo step.
let lastEditSession = 0;

function TransformField({ label, value, step, onCommit }) {
    // Text being typed, or null to show value.
    const [draft, setDraft] = useState(null);
    const editSessionRef = useRef(0);

    return (
        <label className="scene-transform-field">
            {label}
            <input
                type="number"
                step={step}
                value={draft ?? String(Number(value.toFixed(4)))}
                onFocus={() => { editSessionRef.current = ++lastEditSession; }}
                onChange={(event) => {
                    setDraft(event.target.value);
                    const parsed = parseFloat(event.target.value);
                    if (Number.isFinite(parsed)) onCommit(parsed, editSessionRef.current);
                }}
                onBlur={() => setDraft(null)}
            />
        </label>
    );
}

const CONTEXT_MENU_WIDTH = 150;
const CONTEXT_MENU_HEIGHT = 40;

function OutlinerContextMenu({ x, y, onDelete, onClose }) {
    const menuRef = useRef(null);

    // Close on a click outside, Esc, scrolling or resizing.
    useEffect(() => {
        function handlePointerDown(event) {
            if (!menuRef.current?.contains(event.target)) onClose();
        }
        function handleKeyDown(event) {
            if (event.key === 'Escape') onClose();
        }
        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('scroll', onClose, true);
        window.addEventListener('resize', onClose);
        window.addEventListener('blur', onClose);
        return () => {
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('scroll', onClose, true);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('blur', onClose);
        };
    }, [onClose]);

    // Keep the menu on screen near the window's right and bottom edges.
    const left = Math.min(x, window.innerWidth - CONTEXT_MENU_WIDTH - 8);
    const top = Math.min(y, window.innerHeight - CONTEXT_MENU_HEIGHT - 8);

    return (
        <div
            ref={menuRef}
            className="scene-context-menu"
            role="menu"
            style={{ left, top, width: CONTEXT_MENU_WIDTH }}
            onContextMenu={(event) => event.preventDefault()}
        >
            <button className="scene-context-item is-danger" role="menuitem" onClick={onDelete} autoFocus>
                <Icon name="trash" size={13} /> Delete
            </button>
        </div>
    );
}

function LibraryPicker({ onPick, onClose }) {
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [search, setSearch] = useState('');

    useEffect(() => {
        let isCancelled = false;

        async function loadJobs() {
            try {
                const res = await fetch('/jobs');
                if (!res.ok) throw new Error(`Server returned ${res.status}`);
                const data = await res.json();
                if (!isCancelled) setJobs(data);
            } catch (err) {
                if (!isCancelled) setLoadError(err.message);
            } finally {
                if (!isCancelled) setIsLoading(false);
            }
        }

        loadJobs();
        return () => { isCancelled = true; };
    }, []);

    useEffect(() => {
        function handleKeyDown(event) {
            if (event.key === 'Escape') onClose();
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const normalizedSearch = search.trim().toLowerCase();
    const models = jobs
        .filter((job) => job.hasResult)
        .map((job) => ({ id: job.id, name: jobDisplayName(job, 'Model'), photoCount: job.imageCount ?? 0 }))
        .filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(normalizedSearch));

    return (
        <div className="scene-picker-backdrop" onClick={onClose}>
            <div
                className="scene-picker"
                role="dialog"
                aria-label="Add from Library"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="scene-picker-head">
                    <span className="scene-panel-title">Add from Library</span>
                    <button className="scene-picker-close" onClick={onClose} aria-label="Close">×</button>
                </div>
                <input
                    className="scene-outliner-search"
                    placeholder="Search models..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    autoFocus
                />

                <div className="scene-picker-list">
                    {isLoading && <p className="scene-picker-note">Loading...</p>}
                    {loadError && <p className="scene-picker-note is-error">Couldn't load models: {loadError}</p>}
                    {!isLoading && !loadError && models.length === 0 && (
                        <p className="scene-picker-note">
                            {normalizedSearch ? 'No models match your search.' : 'No finished models yet. Train one first.'}
                        </p>
                    )}
                    {models.map((model) => (
                        <button key={model.id} className="scene-picker-item" onClick={() => onPick(model)}>
                            <Icon name="cube" size={16} />
                            <span className="scene-picker-name">{model.name}</span>
                            <span className="scene-picker-meta">{model.photoCount} photos</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

function SceneBuilderScreen({ objects, onObjectsChange, onUndo, canUndo }) {
    const [activeToolTab, setActiveToolTab] = useState('Polygon');
    const [activeTransformTool, setActiveTransformTool] = useState('Move');
    const [selectedId, setSelectedId] = useState(() => objects[0]?.id ?? null);
    const [outlinerSearch, setOutlinerSearch] = useState('');
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    // Right-click menu on an outliner row: { objectId, x, y }, or null when closed.
    const [contextMenu, setContextMenu] = useState(null);
    const [inspectorTab, setInspectorTab] = useState('Object');
    const [openSections, setOpenSections] = useState({ transform: true, splats: true, object: true });
    const [frame, setFrame] = useState(12);
    const [isPlaying, setIsPlaying] = useState(false);
    // Load results from the viewport by object id: { splatCount } or { error }.
    // Not part of the undo history; the viewport reports again after a remount.
    const [modelStatus, setModelStatus] = useState({});

    const selected = objects.find((object) => object.id === selectedId);
    const selectedStatus = selected && modelStatus[selected.id];
    const normalizedSearch = outlinerSearch.trim().toLowerCase();
    const visibleObjects = objects.filter((object) => object.name.toLowerCase().includes(normalizedSearch));

    function updateObject(objectId, changes, options) {
        onObjectsChange((current) =>
            current.map((object) => (object.id === objectId ? { ...object, ...changes } : object)),
            options
        );
    }

    // Also clears an old status when an undo brings back a removed model.
    const handleModelLoadStart = useCallback((objectId) => {
        setModelStatus((current) => ({ ...current, [objectId]: {} }));
    }, []);

    const handleModelLoaded = useCallback((objectId, { splatCount }) => {
        setModelStatus((current) => ({ ...current, [objectId]: { splatCount } }));
    }, []);

    const handleModelFailed = useCallback((objectId, message) => {
        setModelStatus((current) => ({ ...current, [objectId]: { error: message } }));
    }, []);

    const closePicker = useCallback(() => setIsPickerOpen(false), []);
    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    useEffect(() => {
        function handleKeyDown(event) {
            const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey &&
                event.key.toLowerCase() === 'z';
            if (!isUndo) return;
            // Search boxes keep the browser's own text undo.
            if (isTextEntry(event.target)) return;

            event.preventDefault();
            // Leave a transform field first, so it shows the restored value
            // instead of the text that was being typed.
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            onUndo();
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onUndo]);

    // 1 / 2 / 3 pick the gizmo mode (W/A/S/D move the model, see SceneViewport).
    useEffect(() => {
        function handleKeyDown(event) {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const target = event.target;
            if (target instanceof HTMLElement && (target.isContentEditable ||
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
            const tool = TRANSFORM_TOOLS.find((candidate) => candidate.shortcut === event.key.toLowerCase());
            if (tool) setActiveTransformTool(tool.name);
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    function toggleSection(sectionName) {
        setOpenSections((current) => ({ ...current, [sectionName]: !current[sectionName] }));
    }

    function addModel(model) {
        playSound('click');
        const object = createSceneObject(model, objects);
        onObjectsChange((current) => [...current, object]);
        setSelectedId(object.id);
        setIsPickerOpen(false);
    }

    function setTransformValue(field, value, editSession) {
        const next = [...selected[field.key]];
        next[field.axis] = value;
        updateObject(selected.id, { [field.key]: next }, {
            mergeKey: `transform:${selected.id}:${field.label}:${editSession}`,
        });
    }

    function duplicateSelected() {
        const copy = {
            ...createSceneObject({ id: selected.jobId, name: selected.name.replace(/ \(\d+\)$/, '') }, objects),
            position: [...selected.position],
            rotation: [...selected.rotation],
            scale: [...selected.scale],
            visible: selected.visible,
        };
        onObjectsChange((current) => [...current, copy]);
        setSelectedId(copy.id);
    }

    function removeObject(objectId) {
        const index = objects.findIndex((object) => object.id === objectId);
        const remaining = objects.filter((object) => object.id !== objectId);
        onObjectsChange((current) => current.filter((object) => object.id !== objectId));
        // Removing the selected model selects its neighbour in the list.
        if (objectId === selectedId) {
            setSelectedId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
        }
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
                {TRANSFORM_TOOLS.map((tool) => (
                    <button
                        key={tool.name}
                        className={activeTransformTool === tool.name ? 'scene-chip is-active' : 'scene-chip'}
                        onClick={() => setActiveTransformTool(tool.name)}
                        title={`${tool.name} (${tool.shortcut.toUpperCase()})`}
                    >
                        {tool.name}
                    </button>
                ))}
                <span className="scene-bar-divider" />
                <button className="scene-chip" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
                    Undo
                </button>
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
                        {objects.length === 0 && <p className="scene-outliner-note">The scene is empty.</p>}
                        {visibleObjects.map((object) => (
                            <div
                                key={object.id}
                                className={[
                                    'scene-outliner-item',
                                    object.id === selectedId && 'is-active',
                                    !object.visible && 'is-hidden',
                                ].filter(Boolean).join(' ')}
                                onClick={() => setSelectedId(object.id)}
                                onContextMenu={(event) => {
                                    event.preventDefault();
                                    setSelectedId(object.id);
                                    setContextMenu({ objectId: object.id, x: event.clientX, y: event.clientY });
                                }}
                                title={modelStatus[object.id]?.error}
                            >
                                <Icon name="layers" size={13} />
                                <span className="scene-outliner-name">{object.name}</span>
                                {modelStatus[object.id]?.error ? (
                                    <span className="scene-outliner-status is-error">failed</span>
                                ) : modelStatus[object.id]?.splatCount === undefined && (
                                    <span className="scene-outliner-status">loading</span>
                                )}
                                <button
                                    className="scene-outliner-eye"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        updateObject(object.id, { visible: !object.visible });
                                    }}
                                    aria-label={object.visible ? 'Hide' : 'Show'}
                                    aria-pressed={!object.visible}
                                >
                                    <Icon name="eye" size={12} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <button
                        className="scene-add-library"
                        onClick={() => {
                            playSound('click');
                            setIsPickerOpen(true);
                        }}
                    >
                        <Icon name="plus" size={12} /> Add from Library
                    </button>
                </div>

                <div className="scene-viewport">
                    <div className="scene-viewport-menu">
                        {VIEWPORT_MENUS.map((menuName) => <span key={menuName}>{menuName}</span>)}
                        <span className="scene-viewport-label">persp</span>
                    </div>

                    <SceneViewport
                        objects={objects}
                        selectedId={selectedId}
                        transformMode={TRANSFORM_TOOLS.find((tool) => tool.name === activeTransformTool).mode}
                        onObjectTransform={(objectId, transform, dragSession) =>
                            updateObject(objectId, transform, { mergeKey: `drag:${dragSession}` })}
                        onModelLoaded={handleModelLoaded}
                        onModelLoadStart={handleModelLoadStart}
                        onModelFailed={handleModelFailed}
                    />

                    {objects.length === 0 && (
                        <div className="scene-viewport-empty">
                            <Icon name="cube" size={36} />
                            <p>Add a model from your library to start building the scene.</p>
                            <button className="scene-chip is-active" onClick={() => setIsPickerOpen(true)}>
                                Add from Library
                            </button>
                        </div>
                    )}

                    <div className="scene-axes">
                        <span className="scene-axis-x">X</span>
                        <span className="scene-axis-y">Y</span>
                        <span className="scene-axis-z">Z</span>
                    </div>
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
                            Use Add from Library to bring your trained models into the scene, then
                            select one in the outliner. Drag the gizmo's arrows, rings or boxes to
                            move, rotate or scale just that model (1 / 2 / 3 switch between them),
                            press W / A / S / D to slide it along the ground (hold Shift for bigger
                            steps), or type exact values in Transform. Drag anywhere else to orbit,
                            right-drag to pan and scroll to zoom. Ctrl+Z undoes the last change.
                        </p>
                    ) : !selected ? (
                        <p className="scene-help">Select a model in the outliner to edit it.</p>
                    ) : (
                        <>
                            <button className="scene-section-head" onClick={() => toggleSection('transform')}>
                                <Icon name="chevron" size={12} /> Transform
                            </button>
                            {openSections.transform && TRANSFORM_FIELDS.map((field) => (
                                <TransformField
                                    key={`${selected.id}-${field.label}`}
                                    label={field.label}
                                    step={field.step}
                                    value={selected[field.key][field.axis]}
                                    onCommit={(value) => setTransformValue(field, value)}
                                />
                            ))}

                            <button className="scene-section-head" onClick={() => toggleSection('splats')}>
                                <Icon name="chevron" size={12} /> Splats
                            </button>
                            {openSections.splats && (
                                <div className="scene-mesh-stats">
                                    <span>Source <b>{selected.jobId.slice(0, 8)}</b></span>
                                    <span>
                                        Splats{' '}
                                        <b>
                                            {selectedStatus?.error
                                                ? 'failed'
                                                : selectedStatus?.splatCount?.toLocaleString() ?? 'loading'}
                                        </b>
                                    </span>
                                </div>
                            )}

                            <button className="scene-section-head" onClick={() => toggleSection('object')}>
                                <Icon name="chevron" size={12} /> Object
                            </button>
                            {openSections.object && (
                                <div className="scene-component-grid">
                                    <button className="scene-chip" onClick={() => updateObject(selected.id, DEFAULT_TRANSFORM)}>
                                        Reset
                                    </button>
                                    <button className="scene-chip" onClick={duplicateSelected}>Duplicate</button>
                                    <button
                                        className="scene-chip"
                                        onClick={() => updateObject(selected.id, { visible: !selected.visible })}
                                    >
                                        {selected.visible ? 'Hide' : 'Show'}
                                    </button>
                                    <button className="scene-chip scene-chip-danger" onClick={() => removeObject(selected.id)}>Remove</button>
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

            {contextMenu && (
                <OutlinerContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onDelete={() => {
                        removeObject(contextMenu.objectId);
                        setContextMenu(null);
                    }}
                    onClose={closeContextMenu}
                />
            )}
            {isPickerOpen && <LibraryPicker onPick={addModel} onClose={closePicker} />}
        </div>
    );
}

export default SceneBuilderScreen;
