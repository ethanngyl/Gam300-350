/*!************************************************************************
\file SceneBuilderScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 21-10-2026
\brief
Scene Builder: arrange finished models (Gaussian splats from GET /jobs)
into a scene, then save it.

Both web and phone: add a model from the library, select it, move /
rotate / scale it by dragging, drop it to the floor, clean up stray
splats with one slider, duplicate, delete, undo / redo, save and reopen.
Web only (advanced): outliner with hide, inspector with exact values and
keep-proportions scaling, advanced clean-up settings, snapping, splat /
point render mode, background colour, reset view, screenshot and
keyboard shortcuts (W/E/R, Ctrl+Z, Ctrl+Y, Delete, Esc).
Phone: bottom tool bar, models list and clean-up in bottom sheets, and a
cap on how many models a scene can hold.

The viewport talks to the engine only through SceneEngine.js, and saving
goes through SceneStorage.js. Both are placeholders for now (see those
files): until the engine exports the scene functions, the viewport shows
a top-down placement map so the rest of the page can be used and tested.
**************************************************************************/

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';
import {
    addSceneModel,
    captureSceneScreenshot,
    getSceneSplatCount,
    measureLowestPoint,
    orbitSceneCamera,
    panSceneCamera,
    pickSceneObject,
    removeSceneModel,
    renderSceneFrame,
    resetSceneCamera,
    setSceneBackground,
    setSceneRenderMode,
    setSceneTransform,
    setSceneTrim,
    setSceneVisible,
    startSceneEngine,
    stopSceneEngine,
    zoomSceneCamera,
} from './SceneEngine.js';
import { SCENES_SAVED_ON_SERVER, deleteScene, listScenes, loadScene, saveScene } from './SceneStorage.js';
import './SceneBuilder.css';

const PHONE_MEDIA_QUERY = '(max-width: 760px)';

const TRANSFORM_MODES = [
    { id: 'move', label: 'Move', icon: 'move', shortcut: 'W' },
    { id: 'rotate', label: 'Rotate', icon: 'refresh', shortcut: 'E' },
    { id: 'scale', label: 'Scale', icon: 'cube', shortcut: 'R' },
];

const DEFAULT_TRIM = { strength: 0, minOpacity: 0, maxSplatSize: 0, density: 0 };
const DEFAULT_BACKGROUND = '#111d29';
const AXIS_LABELS = ['X', 'Y', 'Z'];

// The placeholder map shows -MAP_RANGE_METRES..+MAP_RANGE_METRES on X and Z.
const MAP_RANGE_METRES = 5;
// Drag speed in the engine viewport, where there is no map to measure against.
const ENGINE_METRES_PER_PIXEL = 0.01;
const DEGREES_PER_PIXEL = 0.5;
const SCALE_SPEED_PER_PIXEL = 0.005;
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;

const MOVE_SNAP_METRES = 0.25;
const ROTATE_SNAP_DEGREES = 15;
const SCALE_SNAP = 0.05;

const MAX_HISTORY = 50;
// A click that moves less than this many pixels counts as a tap, not a drag.
const DRAG_THRESHOLD_PIXELS = 4;

// Splats are heavy on phone GPUs, so phone scenes are capped.
const PHONE_MODEL_LIMIT = 4;
const PHONE_SPLAT_BUDGET = 1500000;

function useIsPhone() {
    const [isPhone, setIsPhone] = useState(() => window.matchMedia(PHONE_MEDIA_QUERY).matches);

    useEffect(() => {
        const mediaQueryList = window.matchMedia(PHONE_MEDIA_QUERY);
        function handleChange(event) {
            setIsPhone(event.matches);
        }
        mediaQueryList.addEventListener('change', handleChange);
        return () => mediaQueryList.removeEventListener('change', handleChange);
    }, []);

    return isPhone;
}

function makeObjectId() {
    return `object-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createSceneObject(model) {
    return {
        objectId: makeObjectId(),
        jobId: model.id,
        name: model.name,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        trim: { ...DEFAULT_TRIM },
        isHidden: false,
    };
}

function roundToStep(value, step) {
    return Math.round(value / step) * step;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// Keeps typed values readable (no 0.30000000000000004).
function tidyNumber(value) {
    return Math.round(value * 1000) / 1000;
}

function getModelName(jobId) {
    return `Model ${jobId.slice(0, 8)}`;
}

function getPlyUrl(jobId) {
    return `/jobs/${jobId}/result.ply`;
}

// Three number inputs (X, Y, Z). onEditStart / onEditEnd let the screen
// record one undo step per field edit instead of one per keystroke.
function AxisFields({ label, values, step, onChange, onEditStart, onEditEnd }) {
    return (
        <fieldset className="scene-builder-axis-fields">
            <legend>{label}</legend>
            {values.map((value, axisIndex) => (
                <label key={AXIS_LABELS[axisIndex]} className="scene-builder-axis-field">
                    <span>{AXIS_LABELS[axisIndex]}</span>
                    <input
                        type="number"
                        step={step}
                        value={tidyNumber(value)}
                        onFocus={onEditStart}
                        onBlur={onEditEnd}
                        onChange={(event) => {
                            const typedValue = Number(event.target.value);
                            if (Number.isFinite(typedValue)) onChange(axisIndex, typedValue);
                        }}
                    />
                </label>
            ))}
        </fieldset>
    );
}

function TrimSlider({ label, value, onChange, onEditStart, onEditEnd }) {
    return (
        <label className="scene-builder-slider">
            <span>{label} <b>{Math.round(value * 100)}%</b></span>
            <input
                type="range"
                min={0}
                max={100}
                value={Math.round(value * 100)}
                onPointerDown={onEditStart}
                onPointerUp={onEditEnd}
                onBlur={onEditEnd}
                onChange={(event) => onChange(Number(event.target.value) / 100)}
            />
        </label>
    );
}

function ModelPickerDialog({ models, modelsStatus, onPick, onClose }) {
    return (
        <div className="scene-builder-dialog-backdrop" onClick={onClose}>
            <div
                className="forma-card scene-builder-dialog"
                role="dialog"
                aria-label="Add a model"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="scene-builder-dialog-head">
                    <h2>Add a model</h2>
                    <button className="forma-btn" onClick={onClose}>Close</button>
                </div>

                {modelsStatus === 'loading' && <p className="scene-builder-note">Loading your models...</p>}
                {modelsStatus === 'error' && (
                    <p className="scene-builder-note">Could not load your models. Is the server running?</p>
                )}
                {modelsStatus === 'ready' && models.length === 0 && (
                    <p className="scene-builder-note">No finished models yet. Build one from your photos first.</p>
                )}

                <div className="scene-builder-model-grid">
                    {models.map((model) => (
                        <button key={model.id} className="scene-builder-model-card" onClick={() => onPick(model)}>
                            <span className="scene-builder-model-thumb">
                                {model.thumbnailUrl ? <img src={model.thumbnailUrl} alt="" /> : <Icon name="cube" size={22} />}
                            </span>
                            <span className="scene-builder-model-name">{model.name}</span>
                            <span className="scene-builder-model-meta">{model.photoCount} photos</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

function SceneListDialog({ onOpenScene, onClose }) {
    const [scenes, setScenes] = useState([]);
    const [listStatus, setListStatus] = useState('loading');
    // Bumped after a delete to load the list again.
    const [listVersion, setListVersion] = useState(0);

    useEffect(() => {
        let isCancelled = false;

        listScenes()
            .then((savedScenes) => {
                if (isCancelled) return;
                setScenes(savedScenes);
                setListStatus('ready');
            })
            .catch(() => {
                if (!isCancelled) setListStatus('error');
            });

        return () => {
            isCancelled = true;
        };
    }, [listVersion]);

    async function handleDelete(scene) {
        if (!window.confirm(`Delete "${scene.name}"? This can't be undone.`)) return;
        playSound('back');
        await deleteScene(scene.id);
        setListVersion((version) => version + 1);
    }

    return (
        <div className="scene-builder-dialog-backdrop" onClick={onClose}>
            <div
                className="forma-card scene-builder-dialog"
                role="dialog"
                aria-label="Open a scene"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="scene-builder-dialog-head">
                    <h2>Open a scene</h2>
                    <button className="forma-btn" onClick={onClose}>Close</button>
                </div>

                {listStatus === 'loading' && <p className="scene-builder-note">Loading scenes...</p>}
                {listStatus === 'error' && <p className="scene-builder-note">Could not load saved scenes.</p>}
                {listStatus === 'ready' && scenes.length === 0 && (
                    <p className="scene-builder-note">No saved scenes yet.</p>
                )}

                <ul className="scene-builder-scene-list">
                    {scenes.map((scene) => (
                        <li key={scene.id}>
                            <button className="scene-builder-scene-open" onClick={() => onOpenScene(scene.id)}>
                                <span className="scene-builder-model-name">{scene.name}</span>
                                <span className="scene-builder-model-meta">
                                    {scene.objectCount} models - {new Date(scene.updatedAt).toLocaleString('en-SG')}
                                </span>
                            </button>
                            <button className="forma-btn" onClick={() => handleDelete(scene)}>Delete</button>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

// Viewport: the engine canvas, plus the top-down placeholder map while
// the engine can't render scenes yet. Reports drags in pixels; the screen
// turns them into transform changes.
function SceneViewport({
    objects,
    selectedObjectId,
    background,
    onEngineReadyChange,
    onSelect,
    onDragStart,
    onDrag,
    onDragEnd,
}) {
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const mapRef = useRef(null);
    const pointerRef = useRef(null);
    const [isEngineRunning, setIsEngineRunning] = useState(false);

    useEffect(() => {
        let isCancelled = false;
        let animationFrameId = 0;

        function renderLoop() {
            const canvas = canvasRef.current;
            if (canvas) {
                const width = canvas.clientWidth * window.devicePixelRatio;
                const height = canvas.clientHeight * window.devicePixelRatio;
                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;
                }
                renderSceneFrame(width, height);
            }
            animationFrameId = requestAnimationFrame(renderLoop);
        }

        startSceneEngine(canvasRef.current).then((didStart) => {
            if (isCancelled) return;
            setIsEngineRunning(didStart);
            onEngineReadyChange(didStart);
            if (didStart) animationFrameId = requestAnimationFrame(renderLoop);
        });

        return () => {
            isCancelled = true;
            cancelAnimationFrame(animationFrameId);
            stopSceneEngine();
        };
    }, [onEngineReadyChange]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !isEngineRunning) return;

        function handleWheel(event) {
            event.preventDefault();
            zoomSceneCamera(clamp(-event.deltaY / 100, -2, 2));
        }

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, [isEngineRunning]);

    function getMetresPerPixel() {
        if (isEngineRunning || !mapRef.current) return ENGINE_METRES_PER_PIXEL;
        return (MAP_RANGE_METRES * 2) / mapRef.current.clientWidth;
    }

    function findObjectUnderPointer(event) {
        if (isEngineRunning) {
            const bounds = canvasRef.current.getBoundingClientRect();
            return pickSceneObject(
                (event.clientX - bounds.left) * window.devicePixelRatio,
                (event.clientY - bounds.top) * window.devicePixelRatio,
            );
        }
        return event.target.closest('[data-object-id]')?.dataset.objectId ?? null;
    }

    function handlePointerDown(event) {
        const objectId = findObjectUnderPointer(event);
        containerRef.current.setPointerCapture(event.pointerId);
        pointerRef.current = {
            objectId,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            isDragging: false,
            usePan: event.button === 2 || event.shiftKey,
        };

        if (objectId) {
            onSelect(objectId);
            onDragStart(objectId);
        }
    }

    function handlePointerMove(event) {
        const pointer = pointerRef.current;
        if (!pointer) return;

        const totalX = event.clientX - pointer.startX;
        const totalY = event.clientY - pointer.startY;
        if (!pointer.isDragging && Math.hypot(totalX, totalY) < DRAG_THRESHOLD_PIXELS) return;
        pointer.isDragging = true;

        if (pointer.objectId) {
            onDrag(pointer.objectId, totalX, totalY, getMetresPerPixel());
        } else if (isEngineRunning) {
            const stepX = event.clientX - pointer.lastX;
            const stepY = event.clientY - pointer.lastY;
            if (pointer.usePan) panSceneCamera(stepX, stepY);
            else orbitSceneCamera(stepX, stepY);
        }

        pointer.lastX = event.clientX;
        pointer.lastY = event.clientY;
    }

    function handlePointerUp() {
        const pointer = pointerRef.current;
        pointerRef.current = null;
        if (!pointer) return;

        if (pointer.objectId) onDragEnd();
        // Tapping empty space clears the selection.
        else if (!pointer.isDragging) onSelect(null);
    }

    function getMapPosition(position) {
        const toPercent = (metres) => clamp((metres / MAP_RANGE_METRES) * 50 + 50, 2, 98);
        return { left: `${toPercent(position[0])}%`, top: `${toPercent(position[2])}%` };
    }

    return (
        <div
            ref={containerRef}
            className="scene-builder-viewport"
            style={{ background }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onContextMenu={(event) => event.preventDefault()}
        >
            <canvas
                ref={canvasRef}
                id="scene-builder-canvas"
                className={isEngineRunning ? 'scene-builder-canvas' : 'scene-builder-canvas is-hidden'}
            />

            {!isEngineRunning && (
                <>
                    <div ref={mapRef} className="scene-builder-map">
                        <span className="scene-builder-map-axis is-x" />
                        <span className="scene-builder-map-axis is-z" />
                        {objects.map((sceneObject) => {
                            const averageScale = (sceneObject.scale[0] + sceneObject.scale[2]) / 2;
                            const markerSize = clamp(20 * averageScale, 12, 64);
                            const className = [
                                'scene-builder-marker',
                                sceneObject.objectId === selectedObjectId ? 'is-selected' : '',
                                sceneObject.isHidden ? 'is-hidden' : '',
                            ].join(' ');

                            return (
                                <button
                                    key={sceneObject.objectId}
                                    type="button"
                                    data-object-id={sceneObject.objectId}
                                    className={className}
                                    style={{ ...getMapPosition(sceneObject.position), width: markerSize, height: markerSize }}
                                    aria-label={sceneObject.name}
                                >
                                    <span
                                        className="scene-builder-marker-facing"
                                        style={{ transform: `rotate(${-sceneObject.rotation[1]}deg)` }}
                                    />
                                    <span className="scene-builder-marker-label">{sceneObject.name}</span>
                                </button>
                            );
                        })}
                    </div>
                    <p className="scene-builder-map-note">
                        Top-down placement preview. The 3D view arrives with the engine update.
                    </p>
                </>
            )}

            {objects.length === 0 && (
                <p className="scene-builder-empty">Add a model to start building your scene.</p>
            )}
        </div>
    );
}

function SceneBuilderScreen() {
    const isPhone = useIsPhone();

    const [sceneId, setSceneId] = useState(null);
    const [sceneName, setSceneName] = useState('Untitled scene');
    const [objects, setObjects] = useState([]);
    const [selectedObjectId, setSelectedObjectId] = useState(null);
    const [transformMode, setTransformMode] = useState('move');
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    const [background, setBackground] = useState(DEFAULT_BACKGROUND);
    const [renderMode, setRenderMode] = useState('splats');
    const [isSnapping, setIsSnapping] = useState(false);
    const [isKeepingProportions, setIsKeepingProportions] = useState(true);

    const [models, setModels] = useState([]);
    const [modelsStatus, setModelsStatus] = useState('loading');
    const [isEngineReady, setIsEngineReady] = useState(false);

    const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
    const [isSceneListOpen, setIsSceneListOpen] = useState(false);
    const [phoneSheet, setPhoneSheet] = useState(null); // null | 'models' | 'cleanup'
    const [statusMessage, setStatusMessage] = useState(null);

    // Latest objects for event handlers, and the state before the current
    // drag / field edit so that whole edit becomes one undo step.
    const objectsRef = useRef(objects);
    const editSnapshotRef = useRef(null);
    const dragStartObjectRef = useRef(null);
    const loadedObjectIdsRef = useRef(new Set());
    const shortcutHandlersRef = useRef({});

    const selectedObject = objects.find((sceneObject) => sceneObject.objectId === selectedObjectId) ?? null;
    const hasReachedPhoneLimit = isPhone && objects.length >= PHONE_MODEL_LIMIT;

    useEffect(() => {
        objectsRef.current = objects;
    }, [objects]);

    // Finished models to add, from the same GET /jobs the Library uses.
    useEffect(() => {
        let isCancelled = false;

        async function loadModels() {
            try {
                const res = await fetch('/jobs');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const jobs = await res.json();
                if (isCancelled) return;
                setModels(
                    jobs
                        .filter((job) => job.status === 'done')
                        .map((job) => ({
                            id: job.id,
                            name: getModelName(job.id),
                            photoCount: job.imageCount ?? job.images?.length ?? 0,
                            thumbnailUrl: job.images?.[0]?.url ?? null,
                        })),
                );
                setModelsStatus('ready');
            } catch {
                if (!isCancelled) setModelsStatus('error');
            }
        }

        loadModels();
        return () => {
            isCancelled = true;
        };
    }, []);

    // Keep the engine's scene in step with objects. All no-ops until the
    // engine exports the scene functions (see SceneEngine.js).
    useEffect(() => {
        if (!isEngineReady) return;

        const currentIds = new Set(objects.map((sceneObject) => sceneObject.objectId));
        for (const loadedId of loadedObjectIdsRef.current) {
            if (!currentIds.has(loadedId)) removeSceneModel(loadedId);
        }

        for (const sceneObject of objects) {
            if (!loadedObjectIdsRef.current.has(sceneObject.objectId)) {
                addSceneModel(sceneObject.objectId, getPlyUrl(sceneObject.jobId));
            }
            setSceneTransform(sceneObject.objectId, {
                position: sceneObject.position,
                rotation: sceneObject.rotation,
                scale: sceneObject.scale,
            });
            setSceneVisible(sceneObject.objectId, !sceneObject.isHidden);
            setSceneTrim(sceneObject.objectId, sceneObject.trim);
        }

        loadedObjectIdsRef.current = currentIds;
    }, [objects, isEngineReady]);

    useEffect(() => {
        setSceneBackground(background);
    }, [background, isEngineReady]);

    useEffect(() => {
        setSceneRenderMode(renderMode);
    }, [renderMode, isEngineReady]);

    // Status messages fade after a few seconds.
    useEffect(() => {
        if (!statusMessage) return;
        const timeoutId = setTimeout(() => setStatusMessage(null), 4000);
        return () => clearTimeout(timeoutId);
    }, [statusMessage]);

    // ---------- History ----------

    function pushHistory(previousObjects) {
        setUndoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), previousObjects]);
        setRedoStack([]);
    }

    // Every change to objects goes through here. Outside a drag or field
    // edit, each change is its own undo step.
    function editObjects(updater) {
        const previousObjects = objectsRef.current;
        const nextObjects = updater(previousObjects);
        objectsRef.current = nextObjects;
        setObjects(nextObjects);
        setHasUnsavedChanges(true);
        if (!editSnapshotRef.current) pushHistory(previousObjects);
    }

    function beginEdit() {
        if (!editSnapshotRef.current) editSnapshotRef.current = objectsRef.current;
    }

    function endEdit() {
        const snapshot = editSnapshotRef.current;
        editSnapshotRef.current = null;
        if (snapshot && snapshot !== objectsRef.current) pushHistory(snapshot);
    }

    function updateObject(objectId, changes) {
        editObjects((current) =>
            current.map((sceneObject) => (sceneObject.objectId === objectId ? { ...sceneObject, ...changes } : sceneObject)),
        );
    }

    function restoreObjects(nextObjects) {
        objectsRef.current = nextObjects;
        setObjects(nextObjects);
        setHasUnsavedChanges(true);
        if (!nextObjects.some((sceneObject) => sceneObject.objectId === selectedObjectId)) {
            setSelectedObjectId(null);
        }
    }

    function undo() {
        if (undoStack.length === 0) return;
        playSound('tap');
        setRedoStack((stack) => [...stack, objectsRef.current]);
        restoreObjects(undoStack[undoStack.length - 1]);
        setUndoStack((stack) => stack.slice(0, -1));
    }

    function redo() {
        if (redoStack.length === 0) return;
        playSound('tap');
        setUndoStack((stack) => [...stack, objectsRef.current]);
        restoreObjects(redoStack[redoStack.length - 1]);
        setRedoStack((stack) => stack.slice(0, -1));
    }

    // ---------- Objects ----------

    function addModel(model) {
        if (hasReachedPhoneLimit) {
            setStatusMessage(`Phone scenes hold up to ${PHONE_MODEL_LIMIT} models. Use a computer for bigger scenes.`);
            return;
        }
        playSound('tap');
        const sceneObject = createSceneObject(model);
        editObjects((current) => [...current, sceneObject]);
        setSelectedObjectId(sceneObject.objectId);
        setIsModelPickerOpen(false);

        if (isPhone && getSceneSplatCount() > PHONE_SPLAT_BUDGET) {
            setStatusMessage('This scene is getting heavy for a phone and may run slowly.');
        }
    }

    function duplicateSelected() {
        if (!selectedObject) return;
        if (hasReachedPhoneLimit) {
            setStatusMessage(`Phone scenes hold up to ${PHONE_MODEL_LIMIT} models.`);
            return;
        }
        playSound('tap');
        const copy = {
            ...selectedObject,
            objectId: makeObjectId(),
            name: `${selectedObject.name} copy`,
            position: [selectedObject.position[0] + 0.5, selectedObject.position[1], selectedObject.position[2] + 0.5],
        };
        editObjects((current) => [...current, copy]);
        setSelectedObjectId(copy.objectId);
    }

    function deleteSelected() {
        if (!selectedObject) return;
        playSound('back');
        editObjects((current) => current.filter((sceneObject) => sceneObject.objectId !== selectedObject.objectId));
        setSelectedObjectId(null);
    }

    function toggleHidden(objectId) {
        playSound('tap');
        const sceneObject = objectsRef.current.find((item) => item.objectId === objectId);
        if (sceneObject) updateObject(objectId, { isHidden: !sceneObject.isHidden });
    }

    function dropSelectedToFloor() {
        if (!selectedObject) return;
        playSound('tap');
        const lowestPoint = measureLowestPoint(selectedObject.objectId);
        const [x, y, z] = selectedObject.position;

        if (lowestPoint === null) {
            // Placeholder until the engine can measure the model.
            updateObject(selectedObject.objectId, { position: [x, 0, z] });
            setStatusMessage('Placed at floor height. An exact fit comes with the engine update.');
        } else {
            updateObject(selectedObject.objectId, { position: [x, y - lowestPoint, z] });
        }
    }

    function changeAxis(propertyName, axisIndex, value) {
        if (!selectedObject) return;
        const nextValues = [...selectedObject[propertyName]];

        if (propertyName === 'scale') {
            const safeValue = clamp(value, MIN_SCALE, MAX_SCALE);
            if (isKeepingProportions && selectedObject.scale[axisIndex] !== 0) {
                const ratio = safeValue / selectedObject.scale[axisIndex];
                nextValues.forEach((axisValue, index) => {
                    nextValues[index] = clamp(axisValue * ratio, MIN_SCALE, MAX_SCALE);
                });
            } else {
                nextValues[axisIndex] = safeValue;
            }
        } else {
            nextValues[axisIndex] = value;
        }

        updateObject(selectedObject.objectId, { [propertyName]: nextValues });
    }

    function changeTrim(settingName, value) {
        if (!selectedObject) return;
        updateObject(selectedObject.objectId, { trim: { ...selectedObject.trim, [settingName]: value } });
    }

    // ---------- Dragging in the viewport ----------

    function handleDragStart(objectId) {
        beginEdit();
        dragStartObjectRef.current = objectsRef.current.find((sceneObject) => sceneObject.objectId === objectId) ?? null;
    }

    function handleDrag(objectId, totalX, totalY, metresPerPixel) {
        const startObject = dragStartObjectRef.current;
        if (!startObject || startObject.objectId !== objectId) return;

        if (transformMode === 'move') {
            let x = startObject.position[0] + totalX * metresPerPixel;
            let z = startObject.position[2] + totalY * metresPerPixel;
            if (isSnapping) {
                x = roundToStep(x, MOVE_SNAP_METRES);
                z = roundToStep(z, MOVE_SNAP_METRES);
            }
            updateObject(objectId, { position: [x, startObject.position[1], z] });
        } else if (transformMode === 'rotate') {
            let yaw = startObject.rotation[1] + totalX * DEGREES_PER_PIXEL;
            if (isSnapping) yaw = roundToStep(yaw, ROTATE_SNAP_DEGREES);
            updateObject(objectId, { rotation: [startObject.rotation[0], yaw, startObject.rotation[2]] });
        } else {
            // Drag up to grow, down to shrink, keeping proportions.
            let factor = Math.exp(-totalY * SCALE_SPEED_PER_PIXEL);
            if (isSnapping) factor = Math.max(SCALE_SNAP, roundToStep(factor, SCALE_SNAP));
            updateObject(objectId, {
                scale: startObject.scale.map((axisValue) => clamp(axisValue * factor, MIN_SCALE, MAX_SCALE)),
            });
        }
    }

    function handleDragEnd() {
        dragStartObjectRef.current = null;
        endEdit();
    }

    const handleEngineReadyChange = useCallback((isReady) => setIsEngineReady(isReady), []);

    // ---------- Scenes ----------

    function confirmDiscardChanges() {
        return !hasUnsavedChanges || window.confirm('You have unsaved changes. Discard them?');
    }

    function resetHistory() {
        editSnapshotRef.current = null;
        setUndoStack([]);
        setRedoStack([]);
    }

    function startNewScene() {
        if (!confirmDiscardChanges()) return;
        playSound('tap');
        objectsRef.current = [];
        setObjects([]);
        setSceneId(null);
        setSceneName('Untitled scene');
        setSelectedObjectId(null);
        setBackground(DEFAULT_BACKGROUND);
        setRenderMode('splats');
        setHasUnsavedChanges(false);
        resetHistory();
    }

    async function handleSave() {
        playSound('tap');
        try {
            const savedScene = await saveScene({
                id: sceneId ?? undefined,
                name: sceneName.trim() || 'Untitled scene',
                background,
                renderMode,
                objects,
            });
            setSceneId(savedScene.id);
            setHasUnsavedChanges(false);
            setStatusMessage(SCENES_SAVED_ON_SERVER ? 'Scene saved.' : 'Scene saved in this browser. Saving to your account is coming soon.');
        } catch (error) {
            setStatusMessage(`Could not save: ${error.message}`);
        }
    }

    async function handleOpenScene(sceneIdToOpen) {
        if (!confirmDiscardChanges()) return;
        playSound('tap');
        try {
            const scene = await loadScene(sceneIdToOpen);
            // Skip models that were deleted since the scene was saved.
            const availableJobIds = new Set(models.map((model) => model.id));
            const keptObjects = modelsStatus === 'ready'
                ? scene.objects.filter((sceneObject) => availableJobIds.has(sceneObject.jobId))
                : scene.objects;
            const skippedCount = scene.objects.length - keptObjects.length;

            objectsRef.current = keptObjects;
            setObjects(keptObjects);
            setSceneId(scene.id);
            setSceneName(scene.name);
            setBackground(scene.background ?? DEFAULT_BACKGROUND);
            setRenderMode(scene.renderMode ?? 'splats');
            setSelectedObjectId(null);
            setHasUnsavedChanges(false);
            resetHistory();
            setIsSceneListOpen(false);
            if (skippedCount > 0) {
                setStatusMessage(`${skippedCount} model${skippedCount === 1 ? ' was' : 's were'} deleted and left out.`);
            }
        } catch (error) {
            setStatusMessage(`Could not open scene: ${error.message}`);
        }
    }

    async function handleScreenshot() {
        playSound('tap');
        const imageBlob = await captureSceneScreenshot();
        if (!imageBlob) {
            setStatusMessage('Screenshots arrive with the engine update.');
            return;
        }
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(imageBlob);
        downloadLink.download = `${sceneName.trim() || 'scene'}.png`;
        downloadLink.click();
        URL.revokeObjectURL(downloadLink.href);
    }

    function chooseTransformMode(modeId) {
        playSound('tap');
        setTransformMode(modeId);
    }

    // ---------- Keyboard shortcuts (web) ----------

    // undo, redo and deleteSelected read the latest state, so the ref is
    // refreshed every render; the keydown listener below is only added once.
    useEffect(() => {
        shortcutHandlersRef.current = { undo, redo, deleteSelected };
    });

    useEffect(() => {
        function handleKeyDown(event) {
            const typingTarget = event.target.closest?.('input, textarea, select');
            if (typingTarget) return;

            const handlers = shortcutHandlersRef.current;
            const key = event.key.toLowerCase();
            const isCommand = event.ctrlKey || event.metaKey;

            if (isCommand && key === 'z' && !event.shiftKey) {
                event.preventDefault();
                handlers.undo();
            } else if (isCommand && (key === 'y' || (key === 'z' && event.shiftKey))) {
                event.preventDefault();
                handlers.redo();
            } else if (key === 'delete' || key === 'backspace') {
                handlers.deleteSelected();
            } else if (key === 'escape') {
                setSelectedObjectId(null);
            } else if (!isCommand) {
                const mode = TRANSFORM_MODES.find((transformOption) => transformOption.shortcut.toLowerCase() === key);
                if (mode) setTransformMode(mode.id);
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // ---------- Pieces shared by web and phone ----------

    const transformButtons = TRANSFORM_MODES.map((mode) => (
        <button
            key={mode.id}
            className={transformMode === mode.id ? 'scene-builder-tool is-active' : 'scene-builder-tool'}
            onClick={() => chooseTransformMode(mode.id)}
            title={isPhone ? mode.label : `${mode.label} (${mode.shortcut})`}
        >
            <Icon name={mode.icon} size={16} />
            <span>{mode.label}</span>
        </button>
    ));

    const objectList = (
        <ul className="scene-builder-outliner-list">
            {objects.map((sceneObject) => (
                <li
                    key={sceneObject.objectId}
                    className={sceneObject.objectId === selectedObjectId ? 'scene-builder-outliner-item is-selected' : 'scene-builder-outliner-item'}
                >
                    <button
                        className="scene-builder-outliner-name"
                        onClick={() => {
                            playSound('tap');
                            setSelectedObjectId(sceneObject.objectId);
                        }}
                    >
                        <Icon name="cube" size={13} />
                        <span className={sceneObject.isHidden ? 'is-hidden' : ''}>{sceneObject.name}</span>
                    </button>
                    <button
                        className="scene-builder-icon-button"
                        onClick={() => toggleHidden(sceneObject.objectId)}
                        aria-label={sceneObject.isHidden ? `Show ${sceneObject.name}` : `Hide ${sceneObject.name}`}
                        title={sceneObject.isHidden ? 'Show' : 'Hide'}
                    >
                        <Icon name="eye" size={14} />
                    </button>
                </li>
            ))}
        </ul>
    );

    const cleanupSlider = selectedObject && (
        <TrimSlider
            label="Clean up stray splats"
            value={selectedObject.trim.strength}
            onChange={(value) => changeTrim('strength', value)}
            onEditStart={beginEdit}
            onEditEnd={endEdit}
        />
    );

    const sceneHeading = (
        <div className="scene-builder-heading">
            <div className="scene-builder-title">
                <p className="eyebrow">Scene Builder</p>
                <input
                    className="scene-builder-name-input"
                    value={sceneName}
                    onChange={(event) => {
                        setSceneName(event.target.value);
                        setHasUnsavedChanges(true);
                    }}
                    aria-label="Scene name"
                />
                {hasUnsavedChanges && <span className="scene-builder-unsaved">Unsaved</span>}
            </div>
            <div className="scene-builder-heading-actions">
                {!isPhone && <button className="forma-btn" onClick={startNewScene}>New</button>}
                <button
                    className="forma-btn"
                    onClick={() => {
                        playSound('tap');
                        setIsSceneListOpen(true);
                    }}
                >
                    <Icon name="folder" size={14} /> Open
                </button>
                <button className="forma-btn forma-btn-primary" onClick={handleSave}>
                    <Icon name="check" size={14} /> Save
                </button>
            </div>
        </div>
    );

    const viewport = (
        <SceneViewport
            objects={objects}
            selectedObjectId={selectedObjectId}
            background={background}
            onEngineReadyChange={handleEngineReadyChange}
            onSelect={setSelectedObjectId}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
        />
    );

    const dialogs = (
        <>
            {isModelPickerOpen && (
                <ModelPickerDialog
                    models={models}
                    modelsStatus={modelsStatus}
                    onPick={addModel}
                    onClose={() => setIsModelPickerOpen(false)}
                />
            )}
            {isSceneListOpen && (
                <SceneListDialog onOpenScene={handleOpenScene} onClose={() => setIsSceneListOpen(false)} />
            )}
            {statusMessage && <div className="scene-builder-toast" role="status">{statusMessage}</div>}
        </>
    );

    function openModelPicker() {
        playSound('tap');
        setIsModelPickerOpen(true);
    }

    // ---------- Phone layout ----------

    if (isPhone) {
        return (
            <div className="scene-builder is-phone">
                {sceneHeading}
                {viewport}

                {phoneSheet === 'models' && (
                    <div className="forma-card scene-builder-sheet">
                        <div className="scene-builder-sheet-head">
                            <span className="eyebrow">Models in scene</span>
                            <button className="forma-btn" onClick={openModelPicker} disabled={hasReachedPhoneLimit}>
                                <Icon name="plus" size={14} /> Add
                            </button>
                        </div>
                        {objects.length === 0 ? <p className="scene-builder-note">No models yet.</p> : objectList}
                        {selectedObject && (
                            <div className="scene-builder-sheet-actions">
                                <button className="forma-btn" onClick={duplicateSelected}>Duplicate</button>
                                <button className="forma-btn" onClick={deleteSelected}>Delete</button>
                            </div>
                        )}
                        {hasReachedPhoneLimit && (
                            <p className="scene-builder-note">Phone scenes hold up to {PHONE_MODEL_LIMIT} models.</p>
                        )}
                    </div>
                )}

                {phoneSheet === 'cleanup' && (
                    <div className="forma-card scene-builder-sheet">
                        {selectedObject ? cleanupSlider : <p className="scene-builder-note">Select a model first.</p>}
                    </div>
                )}

                <p className="scene-builder-note scene-builder-desktop-hint">
                    Exact values, advanced clean-up and snapping are on the computer version.
                </p>

                <div className="scene-builder-bottom-bar">
                    <button
                        className={phoneSheet === 'models' ? 'scene-builder-tool is-active' : 'scene-builder-tool'}
                        onClick={() => {
                            playSound('tap');
                            setPhoneSheet(phoneSheet === 'models' ? null : 'models');
                        }}
                    >
                        <Icon name="layers" size={16} />
                        <span>Models</span>
                    </button>
                    {transformButtons}
                    <button className="scene-builder-tool" onClick={dropSelectedToFloor} disabled={!selectedObject}>
                        <Icon name="target" size={16} />
                        <span>Floor</span>
                    </button>
                    <button
                        className={phoneSheet === 'cleanup' ? 'scene-builder-tool is-active' : 'scene-builder-tool'}
                        onClick={() => {
                            playSound('tap');
                            setPhoneSheet(phoneSheet === 'cleanup' ? null : 'cleanup');
                        }}
                        disabled={!selectedObject}
                    >
                        <Icon name="wand" size={16} />
                        <span>Clean</span>
                    </button>
                </div>

                {dialogs}
            </div>
        );
    }

    // ---------- Web layout ----------

    return (
        <div className="scene-builder">
            {sceneHeading}

            <div className="scene-builder-toolbar">
                <button className="forma-btn forma-btn-primary" onClick={openModelPicker}>
                    <Icon name="plus" size={14} /> Add model
                </button>
                <div className="scene-builder-tool-group">{transformButtons}</div>
                <div className="scene-builder-tool-group">
                    <button className="scene-builder-tool" onClick={undo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">
                        <Icon name="stepBack" size={16} />
                        <span>Undo</span>
                    </button>
                    <button className="scene-builder-tool" onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Y)">
                        <Icon name="stepForward" size={16} />
                        <span>Redo</span>
                    </button>
                </div>
                <label className="scene-builder-toggle">
                    <input
                        type="checkbox"
                        className="photo-editor-switch"
                        checked={isSnapping}
                        onChange={(event) => setIsSnapping(event.target.checked)}
                    />
                    Snap
                </label>
                <div className="scene-builder-tool-group">
                    <button
                        className="scene-builder-tool"
                        onClick={() => {
                            playSound('tap');
                            resetSceneCamera();
                        }}
                        disabled={!isEngineReady}
                        title="Reset view"
                    >
                        <Icon name="eye" size={16} />
                        <span>Reset view</span>
                    </button>
                    <button className="scene-builder-tool" onClick={handleScreenshot} title="Save a screenshot">
                        <Icon name="camera" size={16} />
                        <span>Screenshot</span>
                    </button>
                </div>
            </div>

            <div className="scene-builder-body">
                <aside className="forma-card scene-builder-outliner">
                    <span className="eyebrow">Outliner</span>
                    {objects.length === 0 ? <p className="scene-builder-note">No models yet.</p> : objectList}
                </aside>

                {viewport}

                <aside className="forma-card scene-builder-inspector">
                    {selectedObject ? (
                        <>
                            <span className="eyebrow">Selected model</span>
                            <input
                                className="scene-builder-object-name"
                                value={selectedObject.name}
                                onFocus={beginEdit}
                                onBlur={endEdit}
                                onChange={(event) => updateObject(selectedObject.objectId, { name: event.target.value })}
                                aria-label="Model name"
                            />

                            <AxisFields
                                label="Position (m)"
                                values={selectedObject.position}
                                step={0.1}
                                onChange={(axisIndex, value) => changeAxis('position', axisIndex, value)}
                                onEditStart={beginEdit}
                                onEditEnd={endEdit}
                            />
                            <AxisFields
                                label="Rotation (degrees)"
                                values={selectedObject.rotation}
                                step={5}
                                onChange={(axisIndex, value) => changeAxis('rotation', axisIndex, value)}
                                onEditStart={beginEdit}
                                onEditEnd={endEdit}
                            />
                            <AxisFields
                                label="Scale"
                                values={selectedObject.scale}
                                step={0.1}
                                onChange={(axisIndex, value) => changeAxis('scale', axisIndex, value)}
                                onEditStart={beginEdit}
                                onEditEnd={endEdit}
                            />
                            <label className="scene-builder-toggle">
                                <input
                                    type="checkbox"
                                    className="photo-editor-switch"
                                    checked={isKeepingProportions}
                                    onChange={(event) => setIsKeepingProportions(event.target.checked)}
                                />
                                Keep proportions
                            </label>

                            <div className="scene-builder-inspector-actions">
                                <button className="forma-btn" onClick={dropSelectedToFloor}>
                                    <Icon name="target" size={14} /> Drop to floor
                                </button>
                                <button className="forma-btn" onClick={duplicateSelected}>
                                    <Icon name="layers" size={14} /> Duplicate
                                </button>
                                <button className="forma-btn" onClick={() => toggleHidden(selectedObject.objectId)}>
                                    <Icon name="eye" size={14} /> {selectedObject.isHidden ? 'Show' : 'Hide'}
                                </button>
                                <button className="forma-btn" onClick={deleteSelected}>Delete</button>
                            </div>

                            <span className="eyebrow">Clean up</span>
                            {cleanupSlider}
                            <details className="scene-builder-advanced">
                                <summary>Advanced clean-up</summary>
                                <TrimSlider
                                    label="Remove faint splats"
                                    value={selectedObject.trim.minOpacity}
                                    onChange={(value) => changeTrim('minOpacity', value)}
                                    onEditStart={beginEdit}
                                    onEditEnd={endEdit}
                                />
                                <TrimSlider
                                    label="Remove oversized splats"
                                    value={selectedObject.trim.maxSplatSize}
                                    onChange={(value) => changeTrim('maxSplatSize', value)}
                                    onEditStart={beginEdit}
                                    onEditEnd={endEdit}
                                />
                                <TrimSlider
                                    label="Remove sparse areas"
                                    value={selectedObject.trim.density}
                                    onChange={(value) => changeTrim('density', value)}
                                    onEditStart={beginEdit}
                                    onEditEnd={endEdit}
                                />
                            </details>
                        </>
                    ) : (
                        <>
                            <span className="eyebrow">Scene</span>
                            <p className="scene-builder-note">Select a model to move, rotate or clean it up.</p>
                            <label className="scene-builder-colour">
                                Background
                                <input
                                    type="color"
                                    value={background}
                                    onChange={(event) => {
                                        setBackground(event.target.value);
                                        setHasUnsavedChanges(true);
                                    }}
                                />
                            </label>
                            <div className="scene-builder-segmented" role="group" aria-label="Render mode">
                                {[
                                    { id: 'splats', label: 'Splats' },
                                    { id: 'points', label: 'Points' },
                                ].map((option) => (
                                    <button
                                        key={option.id}
                                        className={renderMode === option.id ? 'is-active' : ''}
                                        onClick={() => {
                                            playSound('tap');
                                            setRenderMode(option.id);
                                            setHasUnsavedChanges(true);
                                        }}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                            <p className="scene-builder-note">
                                Shortcuts: W move, E rotate, R scale, Ctrl+Z undo, Ctrl+Y redo, Delete removes, Esc deselects.
                            </p>
                        </>
                    )}
                </aside>
            </div>

            {dialogs}
        </div>
    );
}

export default SceneBuilderScreen;