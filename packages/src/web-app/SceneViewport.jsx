/*!************************************************************************
\file SceneViewport.jsx
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 26-10-2026
\brief
Embedded multi-splat viewport for the Scene Builder. Unlike SplatViewer it
fills its parent instead of the whole page, and shows every object of the
scene at once in one @mkkellogg/gaussian-splats-3d viewer, each with its
own position, rotation, scale and visibility. The selected object gets a
three.js TransformControls gizmo (move / rotate / scale) drawn on top of
the splats; dragging it moves only that object, while dragging anywhere
else orbits the camera. W/A/S/D slide the selected object along the
ground relative to the camera (Shift for bigger steps); the camera's own
W/A/S/D panning is turned off.
- createViewer(container, gizmoHandlers)
Private helper. Creates and starts an empty viewer inside container,
with the gizmo attached to a "pivot" object that stands in for the
selected model. The viewer's keyboard shortcuts are ignored while the
user types in a text field, so typing "-" in a transform field doesn't
shrink the splats. gizmoHandlers.onChange(pivot, dragSession) is called
while the gizmo is dragged; each drag has its own dragSession number.
- disposeViewer(viewer)
Private helper. Stops the viewer, removes its key handler and gizmo and
frees it. Ignores the error the library's dispose() always throws for a
viewer that isn't a direct child of <body>.
- scenesMatch(viewer, loaded)
Private helper. Whether the viewer's scenes can be read right now (not
mid-dispose or mid-rebuild).
- updateGizmo(viewer, loaded, objects, selectedId, transformMode)
Private helper. Puts the gizmo on the selected object (if it is loaded
and visible) in the given mode, or hides it.
- applyTransforms(viewer, loaded, objects)
Private helper. Copies each object's transform and visibility onto its
splat scene. Each scene is first turned upright (its .ply "Vertical axis"
to +Y), so the rotation and scale fields work in world-up terms.
- SceneViewport({ objects, selectedId, transformMode, onObjectTransform,
                  onModelLoadStart, onModelLoaded, onModelFailed })
React component. Keeps the viewer's scenes in step with objects: loads
models that were added (one at a time, as the viewer allows only one load
or removal at once), removes ones that were deleted, and updates
transforms whenever objects change. transformMode is 'translate',
'rotate' or 'scale'. Gizmo drags and W/A/S/D moves are reported with
onObjectTransform(id, changes, dragSession), where changes holds the new
position (and rotation and scale for a gizmo drag).
Reports each load with onModelLoadStart(id), then
onModelLoaded(id, { splatCount }) or onModelFailed(id, message). A failed
model isn't retried while it stays in the scene; removing it and
bringing it back (e.g. by undo) retries.
- SafeSceneViewport(props)
Default export. SceneViewport inside an error boundary, so an error in
the viewport shows a "Reload viewport" message there instead of blanking
the whole app.
**************************************************************************/

import { Component, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { readCameraUp } from './plyHeader.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DEG_TO_RAD = Math.PI / 180;
// Counts gizmo drags and held move keys, so each is one undo step.
let lastDragSession = 0;
// W/A/S/D -> [forward, right] steps, relative to the camera on the ground plane.
const MOVE_KEYS = { KeyW: [1, 0], KeyS: [-1, 0], KeyD: [0, 1], KeyA: [0, -1] };
const MOVE_STEP = 0.05;
const FAST_MOVE_FACTOR = 5; // with Shift held

function isTypingTarget(target) {
    return target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function createViewer(container, gizmoHandlers) {
    const viewer = new GaussianSplats3D.Viewer({
        rootElement: container,
        cameraUp: [0, 1, 0],
        initialCameraPosition: [-3, 2, 6],
        initialCameraLookAt: [0, 0, 0],
        sharedMemoryForWorkers: false, // no COOP/COEP headers needed in dev
        dynamicScene: true, // transforms change after the models load
        enableOptionalEffects: true, // needed for per-scene visibility
    });

    // The viewer listens for shortcut keys on the whole window. Swap in a
    // listener that skips them while a form field has focus.
    window.removeEventListener('keydown', viewer.keyDownListener);
    viewer.guardedKeyDownListener = (event) => {
        if (!isTypingTarget(event.target)) viewer.keyDownListener?.(event);
    };
    window.addEventListener('keydown', viewer.guardedKeyDownListener);
    // The camera controls pan the whole view on W/A/S/D; those keys move
    // the selected model instead (see SceneViewport).
    for (const orbit of [viewer.perspectiveControls, viewer.orthographicControls]) {
        orbit?.stopListenToKeyEvents();
    }

    // The gizmo moves a stand-in "pivot" object; its transform is copied to
    // the selected model through gizmoHandlers.onChange.
    const gizmoScene = new THREE.Scene();
    const pivot = new THREE.Object3D();
    gizmoScene.add(pivot);
    const controls = new TransformControls(viewer.camera, viewer.renderer.domElement);
    gizmoScene.add(controls.getHelper());
    let dragSession = 0;
    controls.addEventListener('dragging-changed', (event) => {
        if (event.value) dragSession = ++lastDragSession;
        // Stop the camera orbiting while the gizmo is dragged.
        for (const orbit of [viewer.perspectiveControls, viewer.orthographicControls]) {
            if (orbit) orbit.enabled = !event.value;
        }
    });
    controls.addEventListener('objectChange', () => gizmoHandlers.onChange(pivot, dragSession));
    viewer.gizmo = { scene: gizmoScene, pivot, controls };

    // The viewer draws any extra three.js scene before the splats, which
    // would hide the gizmo, so draw it afterwards on top of everything.
    const renderSplats = viewer.render;
    viewer.render = () => {
        renderSplats.call(viewer);
        const renderer = viewer.renderer;
        if (!renderer || viewer.isDisposingOrDisposed()) return;
        const savedAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(gizmoScene, viewer.camera);
        renderer.autoClear = savedAutoClear;
    };

    viewer.start();
    return viewer;
}

function disposeViewer(viewer) {
    window.removeEventListener('keydown', viewer.guardedKeyDownListener);
    viewer.gizmo.controls.detach();
    viewer.gizmo.controls.dispose();
    try {
        viewer.stop();
    } catch {
        /* not started */
    }
    // dispose() ends with document.body.removeChild(rootElement), which
    // throws because our rootElement sits inside the page, not directly in
    // <body>. Everything that matters is cleaned up before that line, so
    // that one error is expected.
    return viewer.dispose().catch((err) => {
        if (err?.name !== 'NotFoundError') throw err;
    });
}

// True when the viewer's scene list matches loaded. It doesn't while the
// viewer is being disposed or rebuilds its scenes to add or remove a
// model; touching scenes then throws, so callers wait for the next sync.
function scenesMatch(viewer, loaded) {
    return !!viewer && !viewer.isDisposingOrDisposed() && !!viewer.splatMesh &&
        viewer.getSceneCount() >= loaded.length;
}

function updateGizmo(viewer, loaded, objects, selectedId, transformMode) {
    if (!viewer || viewer.isDisposingOrDisposed()) return;
    const { controls, pivot } = viewer.gizmo;
    const object = objects.find((candidate) => candidate.id === selectedId);
    const isLoaded = loaded.some((entry) => entry.id === selectedId);
    if (!object || !isLoaded || !object.visible) {
        controls.detach();
        return;
    }

    // Mid-drag the pivot is the source of truth; don't snap it back.
    if (!controls.dragging) {
        pivot.position.fromArray(object.position);
        pivot.rotation.set(...object.rotation.map((degrees) => degrees * DEG_TO_RAD), 'XYZ');
        pivot.scale.fromArray(object.scale);
    }
    controls.setMode(transformMode);
    if (controls.object !== pivot) controls.attach(pivot);
}

function applyTransforms(viewer, loaded, objects) {
    if (!scenesMatch(viewer, loaded)) return;
    const userRotation = new THREE.Quaternion();
    const userMatrix = new THREE.Matrix4();
    const uprightMatrix = new THREE.Matrix4();

    loaded.forEach((entry, sceneIndex) => {
        const object = objects.find((candidate) => candidate.id === entry.id);
        if (!object) return;
        const splatScene = viewer.getSplatScene(sceneIndex);

        const [rx, ry, rz] = object.rotation.map((degrees) => degrees * DEG_TO_RAD);
        userRotation.setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
        userMatrix.compose(
            new THREE.Vector3(...object.position),
            userRotation,
            new THREE.Vector3(...object.scale),
        );
        uprightMatrix.makeRotationFromQuaternion(entry.upright);

        // Set the matrix directly: position/quaternion/scale alone can't hold
        // the upright turn applied before the user's scale.
        splatScene.matrixAutoUpdate = false;
        splatScene.matrix.multiplyMatrices(userMatrix, uprightMatrix);
        splatScene.visible = object.visible;
    });
}

function SceneViewport({
    objects,
    selectedId,
    transformMode,
    onObjectTransform,
    onModelLoadStart,
    onModelLoaded,
    onModelFailed,
}) {
    const containerRef = useRef(null);
    const viewerRef = useRef(null);
    // Latest props, read by the async sync loop and the gizmo.
    const objectsRef = useRef(objects);
    const selectionRef = useRef({ selectedId, transformMode });
    const callbacksRef = useRef({ onObjectTransform, onModelLoadStart, onModelLoaded, onModelFailed });
    // Objects in the viewer, in scene-index order: [{ id, upright }]
    const loadedRef = useRef([]);
    const failedIdsRef = useRef(new Set());
    const syncRef = useRef(null);

    useEffect(() => {
        callbacksRef.current = { onObjectTransform, onModelLoadStart, onModelLoaded, onModelFailed };
    }, [onObjectTransform, onModelLoadStart, onModelLoaded, onModelFailed]);

    useEffect(() => {
        const container = containerRef.current;
        let isDisposed = false;
        const gizmoHandlers = {
            onChange(pivot, dragSession) {
                const transform = {
                    position: pivot.position.toArray(),
                    rotation: [pivot.rotation.x, pivot.rotation.y, pivot.rotation.z].map((radians) => radians / DEG_TO_RAD),
                    scale: pivot.scale.toArray(),
                };
                callbacksRef.current.onObjectTransform?.(selectionRef.current.selectedId, transform, dragSession);
            },
        };
        let viewer = createViewer(container, gizmoHandlers);
        viewerRef.current = viewer;
        loadedRef.current = [];

        async function removeUnwanted() {
            const wantedIds = new Set(objectsRef.current.map((object) => object.id));
            for (const failedId of failedIdsRef.current) {
                if (!wantedIds.has(failedId)) failedIdsRef.current.delete(failedId);
            }
            const loaded = loadedRef.current;
            const kept = loaded.filter((entry) => wantedIds.has(entry.id));
            if (kept.length === loaded.length) return;

            if (kept.length === 0) {
                // The viewer can't remove its last scene, so start over empty.
                // Detach the old viewer first: disposing takes a while, and
                // prop changes in the meantime must not touch it.
                viewerRef.current = null;
                loadedRef.current = [];
                await disposeViewer(viewer).catch((err) => console.warn('Viewer dispose failed:', err));
                if (isDisposed) return;
                viewer = createViewer(container, gizmoHandlers);
                viewerRef.current = viewer;
            } else {
                const indexes = loaded.flatMap((entry, index) => (wantedIds.has(entry.id) ? [] : [index]));
                await viewer.removeSplatScenes(indexes, false);
            }
            loadedRef.current = kept;
        }

        async function loadModel(object) {
            callbacksRef.current.onModelLoadStart?.(object.id);
            const up = new THREE.Vector3(...(await readCameraUp(object.url))).normalize();
            const upright = new THREE.Quaternion().setFromUnitVectors(up, WORLD_UP);
            if (isDisposed) return;

            await viewer.addSplatScenes([{
                path: object.url,
                format: GaussianSplats3D.SceneFormat.Ply,
                splatAlphaRemovalThreshold: 5,
            }], true);
            if (isDisposed) return;

            loadedRef.current = [...loadedRef.current, { id: object.id, upright }];
            // Adding rebuilt every scene without the matrices set here, so
            // put all transforms back before the next frame.
            applyTransforms(viewer, loadedRef.current, objectsRef.current);
            const splatScene = viewer.getSplatScene(loadedRef.current.length - 1);
            callbacksRef.current.onModelLoaded?.(object.id, {
                splatCount: splatScene.splatBuffer.getSplatCount(),
            });
        }

        async function syncOnce() {
            await removeUnwanted();

            // Objects can be added or removed while a model downloads, so
            // re-check what is wanted before each load.
            for (;;) {
                if (isDisposed) return;
                const loadedIds = new Set(loadedRef.current.map((entry) => entry.id));
                const next = objectsRef.current.find(
                    (object) => !loadedIds.has(object.id) && !failedIdsRef.current.has(object.id)
                );
                if (!next) break;
                try {
                    await loadModel(next);
                } catch (err) {
                    if (isDisposed) return;
                    console.error('Failed to load splat scene:', err);
                    failedIdsRef.current.add(next.id);
                    callbacksRef.current.onModelFailed?.(next.id, err?.message || 'Could not load model');
                }
                await removeUnwanted();
            }

            applyTransforms(viewer, loadedRef.current, objectsRef.current);
            const { selectedId: currentId, transformMode: currentMode } = selectionRef.current;
            updateGizmo(viewer, loadedRef.current, objectsRef.current, currentId, currentMode);
        }

        // Runs syncOnce, and again if objects changed while it was running.
        const syncState = { isRunning: false, isStale: false };
        async function sync() {
            if (syncState.isRunning) {
                syncState.isStale = true;
                return;
            }
            syncState.isRunning = true;
            try {
                do {
                    syncState.isStale = false;
                    try {
                        await syncOnce();
                    } catch (err) {
                        console.error('Scene viewport sync failed:', err);
                    }
                } while (syncState.isStale && !isDisposed);
            } finally {
                syncState.isRunning = false;
            }
        }

        // W/A/S/D slide the selected model along the ground, relative to
        // where the camera faces. Holding a key is one undo step.
        let keySession = 0;
        function handleMoveKey(event) {
            const steps = MOVE_KEYS[event.code];
            if (!steps || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
            const { selectedId: currentId } = selectionRef.current;
            const object = objectsRef.current.find((candidate) => candidate.id === currentId);
            const currentViewer = viewerRef.current;
            if (!object || !currentViewer || currentViewer.isDisposingOrDisposed()) return;

            const forward = new THREE.Vector3();
            currentViewer.camera.getWorldDirection(forward);
            forward.y = 0;
            if (forward.lengthSq() < 1e-8) return;
            forward.normalize();
            const right = new THREE.Vector3().crossVectors(forward, WORLD_UP);

            event.preventDefault();
            if (!event.repeat) keySession = ++lastDragSession;
            const step = event.shiftKey ? MOVE_STEP * FAST_MOVE_FACTOR : MOVE_STEP;
            const position = new THREE.Vector3(...object.position)
                .addScaledVector(forward, steps[0] * step)
                .addScaledVector(right, steps[1] * step);
            callbacksRef.current.onObjectTransform?.(currentId, { position: position.toArray() }, keySession);
        }
        window.addEventListener('keydown', handleMoveKey);

        syncRef.current = sync;
        return () => {
            isDisposed = true;
            window.removeEventListener('keydown', handleMoveKey);
            syncRef.current = null;
            viewerRef.current = null;
            disposeViewer(viewer).catch((err) => console.warn('Viewer dispose failed:', err));
        };
    }, []);

    useEffect(() => {
        objectsRef.current = objects;
        selectionRef.current = { selectedId, transformMode };
        // Transform edits show at once; loads and removals go through sync.
        applyTransforms(viewerRef.current, loadedRef.current, objects);
        updateGizmo(viewerRef.current, loadedRef.current, objects, selectedId, transformMode);
        syncRef.current?.();
    }, [objects, selectedId, transformMode]);

    return <div ref={containerRef} className="scene-canvas" />;
}

// Keeps a viewport error inside the viewport instead of blanking the whole
// app. "Reload viewport" remounts it, which loads every model again.
class ViewportErrorBoundary extends Component {
    state = { error: null };

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error) {
        console.error('Scene viewport crashed:', error);
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="scene-canvas scene-viewport-error">
                <p>The viewport hit an error: {this.state.error.message || String(this.state.error)}</p>
                <button className="scene-chip is-active" onClick={() => this.setState({ error: null })}>
                    Reload viewport
                </button>
            </div>
        );
    }
}

function SafeSceneViewport(props) {
    return (
        <ViewportErrorBoundary>
            <SceneViewport {...props} />
        </ViewportErrorBoundary>
    );
}

export default SafeSceneViewport;
