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
rotate / scale it with the viewport gizmo, drop it to the floor, clean up
stray splats with one slider, duplicate, delete, undo / redo, save and
reopen. Web only (advanced): outliner with hide and load status,
inspector with exact values and keep-proportions scaling, advanced
clean-up settings, snapping, splat / point render mode, background
colour, screenshot and keyboard shortcuts (1/2/3, W/A/S/D, Ctrl+Z,
Ctrl+Y, Delete, Esc).
Phone: bottom tool bar, models list and clean-up in bottom sheets, and a
cap on how many models a scene can hold.

The scene's objects (with their undo history) and its id, name and
settings are owned by the parent (App) so the scene survives switching
tabs; this screen edits them through onObjectsChange(updater,
{ mergeKey }) (see useUndoableState.js) and onSceneInfoChange. A whole
field edit, slider drag, gizmo drag or held W/A/S/D key is one undo step.
The 3D view is SceneViewport.jsx. Clean-up, render mode, reset view,
screenshots and an exact drop to floor still wait on the engine (see
SceneEngine.js), and saving goes through SceneStorage.js.
**************************************************************************/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import SceneViewport from './SceneViewport.jsx';
import { jobDisplayName } from './mediaApi.js';
import { playSound } from '../audio/Audio.js';
import { captureSceneScreenshot, isSceneEngineReady, measureLowestPoint, resetSceneCamera } from './SceneEngine.js';
import { NEW_SCENE_INFO, SCENES_SAVED_ON_SERVER, deleteScene, listScenes, loadScene, saveScene } from './SceneStorage.js';
import './SceneBuilder.css';

const PHONE_MEDIA_QUERY = '(max-width: 760px)';

// gizmoMode is the matching SceneViewport transformMode. W/A/S/D move the
// selected model in the viewport, so the modes use number keys.
const TRANSFORM_MODES = [
    { id: 'move', gizmoMode: 'translate', label: 'Move', icon: 'move', shortcut: '1' },
    { id: 'rotate', gizmoMode: 'rotate', label: 'Rotate', icon: 'refresh', shortcut: '2' },
    { id: 'scale', gizmoMode: 'scale', label: 'Scale', icon: 'cube', shortcut: '3' },
];

const DEFAULT_TRIM = { strength: 0, minOpacity: 0, maxSplatSize: 0, density: 0 };
const AXIS_LABELS = ['X', 'Y', 'Z'];

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;

// Gizmo steps while Snap is on.
const GIZMO_SNAP = { move: 0.25, rotateDegrees: 15, scale: 0.05 };

// Splats are heavy on phone GPUs, so phone scenes are capped.
const PHONE_MODEL_LIMIT = 4;
const PHONE_SPLAT_BUDGET = 1500000;

// Counts field edits and slider drags, so two separate edits never share
// an undo step.
let lastEditSession = 0;

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
    // Not crypto.randomUUID: that needs HTTPS, and the app is also opened over plain LAN http.
    return `object-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Placed at the origin, named after the model (numbered if it is already
// in the scene).
function createSceneObject(model, objects) {
    const copies = objects.filter((sceneObject) => sceneObject.jobId === model.id).length;
    return {
        objectId: makeObjectId(),
        jobId: model.id,
        name: copies === 0 ? model.name : `${model.name} (${copies + 1})`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        trim: { ...DEFAULT_TRIM },
        isHidden: false,
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// Keeps typed values readable (no 0.30000000000000004).
function tidyNumber(value) {
    return Math.round(value * 1000) / 1000;
}

function getPlyUrl(jobId) {
    return `/jobs/${jobId}/result.ply`;
}

// Fields where Ctrl+Z should undo the typing rather than the scene.
// Number fields undo the scene, as every keystroke there is a scene edit.
function isTextEntry(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
    return target.tagName === 'INPUT' && target.type !== 'number';
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

                {phoneSheet === 'cleanup' && (
                    <div className="forma-card scene-builder-sheet">
                        {selectedObject ? cleanupSlider : <p className="scene-builder-note">Select a model first.</p>}
                    </div>
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

function SceneBuilderScreen({
    objects,
    onObjectsChange,
    onObjectsReset,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    sceneInfo,
    onSceneInfoChange,
}) {
    const isPhone = useIsPhone();

    const [selectedObjectId, setSelectedObjectId] = useState(null);
    const [transformMode, setTransformMode] = useState('move');
    const [isSnapping, setIsSnapping] = useState(false);
    const [isKeepingProportions, setIsKeepingProportions] = useState(true);

    const [models, setModels] = useState([]);
    const [modelsStatus, setModelsStatus] = useState('loading');
    // Load results from the viewport by objectId: { splatCount } or { error }.
    // Not part of the undo history; the viewport reports again after a remount.
    const [modelStatus, setModelStatus] = useState({});

    const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
    const [isSceneListOpen, setIsSceneListOpen] = useState(false);
    const [phoneSheet, setPhoneSheet] = useState(null); // null | 'models' | 'cleanup'
    const [statusMessage, setStatusMessage] = useState(null);

    // Merge key shared by every change of the current field edit or slider
    // drag, so the whole edit is one undo step. null outside an edit.
    const editKeyRef = useRef(null);
    const shortcutHandlersRef = useRef({});

    const { background, renderMode } = sceneInfo;
    // Undo can remove the selected model; it then counts as unselected.
    const selectedObject = objects.find((sceneObject) => sceneObject.objectId === selectedObjectId) ?? null;
    const selectedStatus = selectedObject && modelStatus[selectedObject.objectId];
    const hasReachedPhoneLimit = isPhone && objects.length >= PHONE_MODEL_LIMIT;
    const sceneSplatCount = objects.reduce(
        (total, sceneObject) => total + (modelStatus[sceneObject.objectId]?.splatCount ?? 0),
        0,
    );
    const isOverPhoneBudget = isPhone && sceneSplatCount > PHONE_SPLAT_BUDGET;

    // The objects as SceneViewport expects them.
    const viewportObjects = useMemo(
        () => objects.map((sceneObject) => ({
            id: sceneObject.objectId,
            url: getPlyUrl(sceneObject.jobId),
            position: sceneObject.position,
            rotation: sceneObject.rotation,
            scale: sceneObject.scale,
            visible: !sceneObject.isHidden,
        })),
        [objects],
    );

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
                        .filter((job) => job.hasResult)
                        .map((job) => ({
                            id: job.id,
                            name: jobDisplayName(job, 'Model'),
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

    // Status messages fade after a few seconds.
    useEffect(() => {
        if (!statusMessage) return;
        const timeoutId = setTimeout(() => setStatusMessage(null), 4000);
        return () => clearTimeout(timeoutId);
    }, [statusMessage]);

    // ---------- Scene info and history ----------

    function changeSceneInfo(changes) {
        onSceneInfoChange((current) => ({ ...current, ...changes }));
    }

    function markUnsaved() {
        onSceneInfoChange((current) => (current.hasUnsavedChanges ? current : { ...current, hasUnsavedChanges: true }));
    }

    // Every change to objects goes through here. Outside a field edit or
    // slider drag, and without a mergeKey, each change is its own undo step.
    function editObjects(updater, mergeKey = editKeyRef.current) {
        onObjectsChange(updater, { mergeKey });
        markUnsaved();
    }

    function beginEdit() {
        if (!editKeyRef.current) editKeyRef.current = `edit:${++lastEditSession}`;
    }

    function endEdit() {
        editKeyRef.current = null;
    }

    function updateObject(objectId, changes, mergeKey) {
        editObjects(
            (current) => current.map((sceneObject) => (
                sceneObject.objectId === objectId ? { ...sceneObject, ...changes } : sceneObject
            )),
            mergeKey,
        );
    }

    // Leave a number field first, so it shows the restored value instead of
    // the text that was being typed.
    function leaveField() {
        endEdit();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }

    function undo() {
        if (!canUndo) return;
        playSound('tap');
        leaveField();
        onUndo();
        markUnsaved();
    }

    function redo() {
        if (!canRedo) return;
        playSound('tap');
        leaveField();
        onRedo();
        markUnsaved();
    }

    // ---------- Objects ----------

    function addModel(model) {
        if (hasReachedPhoneLimit) {
            setStatusMessage(`Phone scenes hold up to ${PHONE_MODEL_LIMIT} models. Use a computer for bigger scenes.`);
            return;
        }
        playSound('tap');
        const sceneObject = createSceneObject(model, objects);
        editObjects((current) => [...current, sceneObject]);
        setSelectedObjectId(sceneObject.objectId);
        setIsModelPickerOpen(false);
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
        const sceneObject = objects.find((item) => item.objectId === objectId);
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

    // ---------- Viewport ----------

    // Gizmo drags and W/A/S/D moves; each drag or held key is one undo step.
    function handleObjectTransform(objectId, transform, dragSession) {
        const changes = transform.scale
            ? { ...transform, scale: transform.scale.map((axisValue) => clamp(axisValue, MIN_SCALE, MAX_SCALE)) }
            : transform;
        updateObject(objectId, changes, `drag:${dragSession}`);
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

    function getStatusLabel(sceneObject) {
        const status = modelStatus[sceneObject.objectId];
        if (status?.error) return 'failed';
        if (status?.splatCount === undefined) return 'loading';
        return null;
    }

    // ---------- Scenes ----------

    function confirmDiscardChanges() {
        return !sceneInfo.hasUnsavedChanges || window.confirm('You have unsaved changes. Discard them?');
    }

    function startNewScene() {
        if (!confirmDiscardChanges()) return;
        playSound('tap');
        endEdit();
        onObjectsReset([]);
        onSceneInfoChange(NEW_SCENE_INFO);
        setSelectedObjectId(null);
    }

    async function handleSave() {
        playSound('confirm');
        try {
            const savedScene = await saveScene({
                id: sceneInfo.id ?? undefined,
                name: sceneInfo.name.trim() || NEW_SCENE_INFO.name,
                background,
                renderMode,
                objects,
            });
            changeSceneInfo({ id: savedScene.id, hasUnsavedChanges: false });
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

            endEdit();
            onObjectsReset(keptObjects);
            onSceneInfoChange({
                id: scene.id,
                name: scene.name,
                background: scene.background ?? NEW_SCENE_INFO.background,
                renderMode: scene.renderMode ?? NEW_SCENE_INFO.renderMode,
                hasUnsavedChanges: false,
            });
            setSelectedObjectId(null);
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
        downloadLink.download = `${sceneInfo.name.trim() || 'scene'}.png`;
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
            const handlers = shortcutHandlersRef.current;
            const key = event.key.toLowerCase();
            const isCommand = event.ctrlKey || event.metaKey;

            if (isCommand && !event.altKey && (key === 'z' || key === 'y')) {
                // Search and name boxes keep the browser's own text undo.
                if (isTextEntry(event.target)) return;
                event.preventDefault();
                if (key === 'z' && !event.shiftKey) handlers.undo();
                else handlers.redo();
                return;
            }

            const typingTarget = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
            if (typingTarget) return;

            if (key === 'delete' || key === 'backspace') {
                handlers.deleteSelected();
            } else if (key === 'escape') {
                setSelectedObjectId(null);
            } else if (!isCommand && !event.altKey) {
                const mode = TRANSFORM_MODES.find((transformOption) => transformOption.shortcut === key);
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
            {objects.map((sceneObject) => {
                const statusLabel = getStatusLabel(sceneObject);
                return (
                    <li
                        key={sceneObject.objectId}
                        className={sceneObject.objectId === selectedObjectId ? 'scene-builder-outliner-item is-selected' : 'scene-builder-outliner-item'}
                        title={modelStatus[sceneObject.objectId]?.error}
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
                            {statusLabel && (
                                <em className={statusLabel === 'failed' ? 'scene-builder-outliner-status is-error' : 'scene-builder-outliner-status'}>
                                    {statusLabel}
                                </em>
                            )}
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
                );
            })}
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
                <p className="eyebrow eyebrow-accent">Scene Builder</p>
                <input
                    className="scene-builder-name-input"
                    value={sceneInfo.name}
                    onChange={(event) => changeSceneInfo({ name: event.target.value, hasUnsavedChanges: true })}
                    aria-label="Scene name"
                />
                {sceneInfo.hasUnsavedChanges && <span className="scene-builder-unsaved">Unsaved</span>}
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
        <div
            className="scene-builder-viewport"
            style={{ background }}
            onContextMenu={(event) => event.preventDefault()}
        >
            <SceneViewport
                objects={viewportObjects}
                selectedId={selectedObjectId}
                transformMode={TRANSFORM_MODES.find((mode) => mode.id === transformMode).gizmoMode}
                snap={isSnapping ? GIZMO_SNAP : null}
                onObjectTransform={handleObjectTransform}
                onModelLoadStart={handleModelLoadStart}
                onModelLoaded={handleModelLoaded}
                onModelFailed={handleModelFailed}
            />
            {objects.length === 0 && (
                <p className="scene-builder-empty">Add a model to start building your scene.</p>
            )}
        </div>
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

                {isOverPhoneBudget && (
                    <p className="scene-builder-note">This scene is getting heavy for a phone and may run slowly.</p>
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
                    <button className="scene-builder-tool" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
                        <Icon name="stepBack" size={16} />
                        <span>Undo</span>
                    </button>
                    <button className="scene-builder-tool" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
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
                        disabled={!isSceneEngineReady()}
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
                            <p className="scene-builder-note">
                                Splats{' '}
                                <b>
                                    {selectedStatus?.error
                                        ? 'failed to load'
                                        : selectedStatus?.splatCount?.toLocaleString() ?? 'loading'}
                                </b>
                            </p>

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
                                    onChange={(event) => changeSceneInfo({ background: event.target.value, hasUnsavedChanges: true })}
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
                                            changeSceneInfo({ renderMode: option.id, hasUnsavedChanges: true });
                                        }}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                            <p className="scene-builder-note">
                                Drag the gizmo's arrows, rings or boxes to move, rotate or scale the selected
                                model, or press W / A / S / D to slide it along the ground (Shift for bigger
                                steps). Drag anywhere else to orbit, right-drag to pan and scroll to zoom.
                            </p>
                            <p className="scene-builder-note">
                                Shortcuts: 1 move, 2 rotate, 3 scale, Ctrl+Z undo, Ctrl+Y redo, Delete removes, Esc deselects.
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