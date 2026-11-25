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
ground relative to the camera (Shift for bigger steps); with snapping on
they step one grid cell (Shift: one metre) along the nearest world axis.
The camera's own W/A/S/D panning is turned off. A sandbox grid lies on the
ground (y = 0) with the X, Y and Z axes through the origin; it shows even
before any model is added.
- createGrid() / applyGrid(viewer, settings)
Private helpers. Build the ground grid (a shader-drawn floor with fine
lines every cell, strong ones every metre and coloured axes, fading out
with distance) and show, hide, resize or recolour it to suit the
background. settings is { visible, cellSize, background }.
- createViewer(container, gizmoHandlers, gridSettings)
Private helper. Creates and starts an empty viewer inside container,
with the grid and the gizmo attached to a "pivot" object that stands in
for the selected model. The viewer's keyboard shortcuts are ignored while
the user types in a text field, so typing "-" in a transform field doesn't
shrink the splats. gizmoHandlers.onChange(pivot, dragSession) is called
while the gizmo is dragged; each drag has its own dragSession number.
While no model is loaded the viewer draws nothing itself, so this moves
the camera and draws the grid instead.
- disposeViewer(viewer)
Private helper. Stops the viewer, removes its key handler and gizmo and
frees it. Ignores the error the library's dispose() always throws for a
viewer that isn't a direct child of <body>.
- scenesMatch(viewer, loaded)
Private helper. Whether the viewer's scenes can be read right now (not
mid-dispose or mid-rebuild).
- updateGizmo(viewer, loaded, objects, selectedId, transformMode, snap)
Private helper. Puts the gizmo on the selected object (if it is loaded
and visible) in the given mode, or hides it. snap is null for free
dragging, or { move, rotateDegrees, scale } steps to snap to.
- applyTransforms(viewer, loaded, objects)
Private helper. Copies each object's transform and visibility onto its
splat scene. Each scene is first turned upright (its .ply "Vertical axis"
to +Y), so the rotation and scale fields work in world-up terms.
- measureLowestPoint(viewer, loaded, objects, objectId)
Private helper. World height of a loaded model's base: a low percentile
of its splat centres (sampled for big models), so a few stray splats
under it are ignored. null if the model isn't loaded.
- focusObject(viewer, loaded, objects, objectId)
Private helper. Smoothly moves the camera so the model fills the view
(keeping the current viewing direction) and makes its middle the orbit
and zoom centre. Dragging or scrolling cancels the move.
- measureBounds(viewer, loaded, objects, objectId)
Private helper. The model's extent with its current rotation but before
its position and scale, { min: [x, y, z], max: [x, y, z] }, ignoring the
outermost 1% of splats on each side. Used to fit a model to the grid.
- SceneViewport({ objects, selectedId, transformMode, snap, showGrid,
                  gridCellSize, background, ref, onObjectTransform,
                  onModelLoadStart, onModelLoaded, onModelFailed })
React component. Keeps the viewer's scenes in step with objects: loads
models that were added (one at a time, as the viewer allows only one load
or removal at once), removes ones that were deleted, and updates
transforms whenever objects change. transformMode is 'translate',
'rotate' or 'scale'; snap is as for updateGizmo. showGrid,
gridCellSize (metres) and background (the '#rrggbb' behind the canvas,
for the line colour) set the grid. ref receives { measureLowestPoint(id),
measureBounds(id), focusObject(id) } while the viewport is mounted. The
scroll wheel zooms toward the mouse pointer. Gizmo drags and W/A/S/D moves are reported with
onObjectTransform(id, changes, dragSession), where changes holds the new
position (and rotation and scale for a gizmo drag).
Reports each load with onModelLoadStart(id), then
onModelLoaded(id, { splatCount }) or onModelFailed(id, message), where
message is a sentence for the user saying why (from checkSplatPly in
plyHeader.js, or a damaged / interrupted download). A failed
model isn't retried while it stays in the scene; removing it and
bringing it back (e.g. by undo) retries.
- SafeSceneViewport(props)
Default export. SceneViewport inside an error boundary, so an error in
the viewport shows a "Reload viewport" message there instead of blanking
the whole app.
**************************************************************************/

import { Component, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { checkSplatPly } from './plyHeader.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DEG_TO_RAD = Math.PI / 180;
// Counts gizmo drags and held move keys, so each is one undo step.
let lastDragSession = 0;
// W/A/S/D -> [forward, right] steps, relative to the camera on the ground plane.
const MOVE_KEYS = { KeyW: [1, 0], KeyS: [-1, 0], KeyD: [0, 1], KeyA: [0, -1] };
const MOVE_STEP = 0.05;
const FAST_MOVE_FACTOR = 5; // with Shift held

// Sandbox grid on the ground (y = 0), in metres. The floor is one large
// quad whose shader draws the lines, so it has no visible edge, stays sharp
// without shimmering, and fades out towards the horizon.
const GRID_EXTENT = 400; // half-width of the quad; inside the camera's 1000 m far plane
const GRID_MAJOR_STEP = 1;
const GRID_OPACITY = { minor: 0.14, major: 0.32, axis: 0.9 };
const AXIS_COLOURS = { x: 0xe5484d, y: 0x46a758, z: 0x3e83f8 };

const GRID_VERTEX_SHADER = `
varying vec3 vWorldPosition;
void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const GRID_FRAGMENT_SHADER = `
uniform float uCellSize;
uniform float uMajorSize;
uniform vec3 uLineColour;
uniform vec3 uAxisXColour;
uniform vec3 uAxisZColour;
uniform vec3 uOpacity; // minor, major, axis
varying vec3 vWorldPosition;

// 1 on a line of the given spacing, 0 between lines, about 1px wide and
// anti-aliased at any distance.
float gridLine(vec2 point, float spacing) {
    vec2 coord = point / spacing;
    vec2 width = fwidth(coord);
    vec2 distanceInPixels = abs(fract(coord - 0.5) - 0.5) / width;
    return 1.0 - min(min(distanceInPixels.x, distanceInPixels.y), 1.0);
}

// Fades lines out once their cells are only a few pixels across, where
// they would otherwise blur into a grey haze.
float densityFade(vec2 point, float spacing) {
    vec2 width = fwidth(point / spacing);
    return 1.0 - smoothstep(0.12, 0.35, max(width.x, width.y));
}

float axisLine(float coordinate) {
    return 1.0 - min(abs(coordinate) / (fwidth(coordinate) * 1.5), 1.0);
}

void main() {
    vec2 point = vWorldPosition.xz;
    float minor = gridLine(point, uCellSize) * densityFade(point, uCellSize) * uOpacity.x;
    float major = gridLine(point, uMajorSize) * densityFade(point, uMajorSize) * uOpacity.y;
    vec4 colour = vec4(uLineColour, max(minor, major));

    // The X axis runs along z = 0, the Z axis along x = 0.
    float axisX = axisLine(point.y) * uOpacity.z;
    float axisZ = axisLine(point.x) * uOpacity.z;
    if (axisX > colour.a) colour = vec4(uAxisXColour, axisX);
    if (axisZ > colour.a) colour = vec4(uAxisZColour, axisZ);

    // Fade with distance (further when the camera is higher up) and at
    // grazing angles, where lines bunch together near the horizon.
    vec3 toCamera = cameraPosition - vWorldPosition;
    float fadeDistance = max(12.0, abs(cameraPosition.y) * 12.0);
    float distanceFade = 1.0 - smoothstep(fadeDistance * 0.35, fadeDistance, length(toCamera.xz));
    float angleFade = smoothstep(0.0, 0.25, abs(normalize(toCamera).y));
    colour.a *= distanceFade * angleFade;

    if (colour.a < 0.005) discard;
    gl_FragColor = colour;
}
`;

function isTypingTarget(target) {
    return target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

// True for a dark background colour ('#rrggbb'), so the grid uses light lines.
function isDarkColour(hexColour) {
    const match = /^#?([0-9a-f]{6})$/i.exec(hexColour ?? '');
    if (!match) return true;
    const value = parseInt(match[1], 16);
    const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

function disposeObject(root) {
    root.traverse((child) => {
        child.geometry?.dispose();
        child.material?.dispose();
    });
}

// Ground grid: fine lines every cell, stronger ones every metre, and the
// X (red) and Z (blue) axes, all drawn by the floor's shader, plus a short
// Y (green) post at the origin.
function createGrid() {
    const grid = new THREE.Group();
    grid.name = 'sandbox-grid';

    const floorGeometry = new THREE.PlaneGeometry(GRID_EXTENT * 2, GRID_EXTENT * 2);
    floorGeometry.rotateX(-Math.PI / 2);
    const floorMaterial = new THREE.ShaderMaterial({
        vertexShader: GRID_VERTEX_SHADER,
        fragmentShader: GRID_FRAGMENT_SHADER,
        uniforms: {
            uCellSize: { value: 0.25 },
            uMajorSize: { value: GRID_MAJOR_STEP },
            uLineColour: { value: new THREE.Color(0xffffff) },
            uAxisXColour: { value: new THREE.Color(AXIS_COLOURS.x) },
            uAxisZColour: { value: new THREE.Color(AXIS_COLOURS.z) },
            uOpacity: { value: new THREE.Vector3(GRID_OPACITY.minor, GRID_OPACITY.major, GRID_OPACITY.axis) },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.frustumCulled = false;
    grid.userData.floor = floor;

    const postGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, GRID_MAJOR_STEP, 0),
    ]);
    const postMaterial = new THREE.LineBasicMaterial({
        color: AXIS_COLOURS.y, transparent: true, opacity: GRID_OPACITY.axis, depthWrite: false,
    });
    grid.add(floor, new THREE.Line(postGeometry, postMaterial));
    return grid;
}

// Shows, hides or recolours the viewer's grid and sets its cell size.
function applyGrid(viewer, settings) {
    if (!viewer || viewer.isDisposingOrDisposed()) return;
    if (!viewer.grid) {
        viewer.grid = createGrid();
        viewer.threeScene.add(viewer.grid);
    }
    const { grid } = viewer;
    grid.visible = settings.visible;
    const { uniforms } = grid.userData.floor.material;
    uniforms.uCellSize.value = settings.cellSize;
    uniforms.uLineColour.value.setHex(isDarkColour(settings.background) ? 0xffffff : 0x000000);
}

function createViewer(container, gizmoHandlers, gridSettings) {
    const viewer = new GaussianSplats3D.Viewer({
        rootElement: container,
        cameraUp: [0, 1, 0],
        initialCameraPosition: [-3, 2, 6],
        initialCameraLookAt: [0, 0, 0],
        sharedMemoryForWorkers: false, // no COOP/COEP headers needed in dev
        dynamicScene: true, // transforms change after the models load
        enableOptionalEffects: true, // needed for per-scene visibility
        // Drawn before the splats, so models cover the grid behind them.
        threeScene: new THREE.Scene(),
    });
    applyGrid(viewer, gridSettings);

    // The viewer listens for shortcut keys on the whole window. Swap in a
    // listener that skips them while a form field has focus.
    window.removeEventListener('keydown', viewer.keyDownListener);
    viewer.guardedKeyDownListener = (event) => {
        if (!isTypingTarget(event.target)) viewer.keyDownListener?.(event);
    };
    window.addEventListener('keydown', viewer.guardedKeyDownListener);
    // The camera controls pan the whole view on W/A/S/D; those keys move
    // the selected model instead (see SceneViewport).
    // The scroll wheel zooms toward what's under the mouse instead of the
    // orbit centre, so a model away from the middle can be zoomed into.
    for (const orbit of [viewer.perspectiveControls, viewer.orthographicControls]) {
        orbit?.stopListenToKeyEvents();
        if (orbit) orbit.zoomToCursor = true;
    }
    // Dragging or scrolling takes over from a focus move in progress.
    const cancelCameraMove = () => {
        viewer.cameraMove = null;
    };
    viewer.renderer.domElement.addEventListener('pointerdown', cancelCameraMove);
    viewer.renderer.domElement.addEventListener('wheel', cancelCameraMove, { passive: true });

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
    function drawGizmo() {
        const renderer = viewer.renderer;
        if (!renderer || viewer.isDisposingOrDisposed()) return;
        const savedAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(gizmoScene, viewer.camera);
        renderer.autoClear = savedAutoClear;
    }
    const renderSplats = viewer.render;
    viewer.render = () => {
        renderSplats.call(viewer);
        drawGizmo();
    };

    // With no model loaded yet the viewer neither moves its camera nor
    // draws anything, which would leave an empty scene without its grid.
    // Do both here until the first model is in.
    const updateSplats = viewer.update;
    viewer.update = (...args) => {
        stepCameraMove(viewer);
        updateSplats.apply(viewer, args);
        const renderer = viewer.renderer;
        const hasSplats = (viewer.splatMesh?.scenes?.length ?? 0) > 0;
        if (hasSplats || !viewer.initialized || !renderer || viewer.isDisposingOrDisposed()) return;
        viewer.controls?.update();
        viewer.updateForRendererSizeChanges();
        const savedAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.clear();
        renderer.render(viewer.threeScene, viewer.camera);
        renderer.autoClear = savedAutoClear;
    };

    viewer.start();
    return viewer;
}

function disposeViewer(viewer) {
    window.removeEventListener('keydown', viewer.guardedKeyDownListener);
    viewer.gizmo.controls.detach();
    viewer.gizmo.controls.dispose();
    if (viewer.grid) disposeObject(viewer.grid);
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

function updateGizmo(viewer, loaded, objects, selectedId, transformMode, snap) {
    if (!viewer || viewer.isDisposingOrDisposed()) return;
    const { controls, pivot } = viewer.gizmo;
    controls.setTranslationSnap(snap?.move ?? null);
    controls.setRotationSnap(snap ? snap.rotateDegrees * DEG_TO_RAD : null);
    controls.setScaleSnap(snap?.scale ?? null);
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

// World height of a loaded model's base, for "Drop to floor": a low
// percentile of its splat centres, so a few stray splats hanging under the
// model don't hold it up. Large models are sampled. null if the model
// isn't loaded (or its splat data can't be read).
const BASE_PERCENTILE = 0.005;
// Ignore the outermost 1% of splats on each side when measuring a footprint.
const EXTENT_PERCENTILE = 0.01;
const MAX_MEASURE_SAMPLES = 200000;

// The value below which `fraction` of the sorted samples lie.
function percentile(sortedValues, fraction) {
    return sortedValues[Math.floor((sortedValues.length - 1) * fraction)];
}

// Splat centres of a loaded model through matrix, as sorted x, y and z
// arrays (sampled for big models). null if the splat data can't be read.
function sampleSplatCentres(splatScene, matrix) {
    const splatBuffer = splatScene?.splatBuffer;
    const splatCount = splatBuffer?.getSplatCount() ?? 0;
    if (splatCount === 0) return null;
    const stride = Math.ceil(splatCount / MAX_MEASURE_SAMPLES);
    const sampleCount = Math.ceil(splatCount / stride);
    const axes = [new Float32Array(sampleCount), new Float32Array(sampleCount), new Float32Array(sampleCount)];
    const centre = new THREE.Vector3();
    try {
        for (let splatIndex = 0, sample = 0; splatIndex < splatCount; splatIndex += stride, sample++) {
            splatBuffer.getSplatCenter(splatIndex, centre, matrix);
            axes[0][sample] = centre.x;
            axes[1][sample] = centre.y;
            axes[2][sample] = centre.z;
        }
    } catch (err) {
        console.warn('Could not read splat centres:', err);
        return null;
    }
    axes.forEach((values) => values.sort());
    return axes;
}

function findLoadedScene(viewer, loaded, objectId) {
    const sceneIndex = loaded.findIndex((entry) => entry.id === objectId);
    if (sceneIndex < 0 || !scenesMatch(viewer, loaded)) return null;
    return { entry: loaded[sceneIndex], splatScene: viewer.getSplatScene(sceneIndex) };
}

function measureLowestPoint(viewer, loaded, objects, objectId) {
    const found = findLoadedScene(viewer, loaded, objectId);
    if (!found) return null;
    // Make sure the matrices match the latest transform, then use the same
    // world matrix the renderer uses for this scene.
    applyTransforms(viewer, loaded, objects);
    found.splatScene.updateWorldMatrix(true, false);
    const axes = sampleSplatCentres(found.splatScene, found.splatScene.matrixWorld);
    return axes ? percentile(axes[1], BASE_PERCENTILE) : null;
}

// A model's size as it stands with its current rotation but before its
// position and scale: { min: [x, y, z], max: [x, y, z] } in metres, robust
// to stray splats (min.y is its base, as for measureLowestPoint).
// null if the model isn't loaded.
function measureBounds(viewer, loaded, objects, objectId) {
    const found = findLoadedScene(viewer, loaded, objectId);
    const object = objects.find((candidate) => candidate.id === objectId);
    if (!found || !object) return null;
    const [rx, ry, rz] = object.rotation.map((degrees) => degrees * DEG_TO_RAD);
    const matrix = new THREE.Matrix4()
        .makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'))
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(found.entry.upright));
    const axes = sampleSplatCentres(found.splatScene, matrix);
    if (!axes) return null;
    return {
        min: [percentile(axes[0], EXTENT_PERCENTILE), percentile(axes[1], BASE_PERCENTILE), percentile(axes[2], EXTENT_PERCENTILE)],
        max: [percentile(axes[0], 1 - EXTENT_PERCENTILE), percentile(axes[1], 1 - BASE_PERCENTILE), percentile(axes[2], 1 - EXTENT_PERCENTILE)],
    };
}

// The model's extent in world space, as drawn: { min, max } with the
// outermost 1% of splats ignored on each side. null if it isn't loaded.
function measureWorldBounds(viewer, loaded, objects, objectId) {
    const found = findLoadedScene(viewer, loaded, objectId);
    if (!found) return null;
    applyTransforms(viewer, loaded, objects);
    found.splatScene.updateWorldMatrix(true, false);
    const axes = sampleSplatCentres(found.splatScene, found.splatScene.matrixWorld);
    if (!axes) return null;
    return {
        min: axes.map((values) => percentile(values, EXTENT_PERCENTILE)),
        max: axes.map((values) => percentile(values, 1 - EXTENT_PERCENTILE)),
    };
}

const CAMERA_MOVE_SECONDS = 0.45;
const FOCUS_MARGIN = 1.3; // some space around a focused model

// Starts a smooth camera move that ends looking at target from position.
function startCameraMove(viewer, target, position) {
    viewer.transitioningCameraTarget = false; // cancel the viewer's own click-to-focus move
    viewer.cameraMove = {
        fromTarget: viewer.controls.target.clone(),
        toTarget: target.clone(),
        fromPosition: viewer.camera.position.clone(),
        toPosition: position.clone(),
        startTime: performance.now(),
    };
}

// Advances the camera move, if any. Runs every frame before the camera
// controls update, so they orbit around the new centre afterwards.
function stepCameraMove(viewer) {
    const move = viewer.cameraMove;
    if (!move || !viewer.controls || !viewer.camera) return;
    const progress = Math.min((performance.now() - move.startTime) / (CAMERA_MOVE_SECONDS * 1000), 1);
    const eased = progress * progress * (3 - 2 * progress);
    viewer.controls.target.lerpVectors(move.fromTarget, move.toTarget, eased);
    viewer.camera.position.lerpVectors(move.fromPosition, move.toPosition, eased);
    if (progress >= 1) viewer.cameraMove = null;
}

// Moves the camera so the model fills the view, looking from the current
// direction, and makes the model's middle the orbit and zoom centre.
// Returns false if the model isn't loaded.
function focusObject(viewer, loaded, objects, objectId) {
    if (!viewer || viewer.isDisposingOrDisposed() || !viewer.controls) return false;
    const bounds = measureWorldBounds(viewer, loaded, objects, objectId);
    if (!bounds) return false;
    const min = new THREE.Vector3(...bounds.min);
    const max = new THREE.Vector3(...bounds.max);
    const centre = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(min.distanceTo(max) / 2, 0.05);

    const camera = viewer.camera;
    const halfVerticalFov = (camera.fov ?? 50) * DEG_TO_RAD / 2;
    const halfHorizontalFov = Math.atan(Math.tan(halfVerticalFov) * (camera.aspect ?? 1));
    const distance = radius * FOCUS_MARGIN / Math.sin(Math.min(halfVerticalFov, halfHorizontalFov));

    const direction = camera.position.clone().sub(viewer.controls.target);
    if (direction.lengthSq() < 1e-8) direction.set(0, 0.5, 1);
    direction.normalize();
    startCameraMove(viewer, centre, centre.clone().addScaledVector(direction, distance));
    return true;
}

function SceneViewport({
    objects,
    selectedId,
    transformMode,
    snap = null,
    showGrid = true,
    gridCellSize = 0.25,
    background = '#000000',
    ref = null,
    onObjectTransform,
    onModelLoadStart,
    onModelLoaded,
    onModelFailed,
}) {
    const containerRef = useRef(null);
    const viewerRef = useRef(null);
    // Latest props, read by the async sync loop and the gizmo.
    const objectsRef = useRef(objects);
    const selectionRef = useRef({ selectedId, transformMode, snap });
    const gridRef = useRef({ visible: showGrid, cellSize: gridCellSize, background });
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
        let viewer = createViewer(container, gizmoHandlers, gridRef.current);
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
                viewer = createViewer(container, gizmoHandlers, gridRef.current);
                viewerRef.current = viewer;
            } else {
                const indexes = loaded.flatMap((entry, index) => (wantedIds.has(entry.id) ? [] : [index]));
                await viewer.removeSplatScenes(indexes, false);
            }
            loadedRef.current = kept;
        }

        async function loadModel(object) {
            callbacksRef.current.onModelLoadStart?.(object.id);
            // Read the header first: it gives the up axis, and a refused
            // download or a non-splat file fails here with a clear reason
            // (the splat library's own errors don't say why).
            const check = await checkSplatPly(object.url);
            if (isDisposed) return;
            if (check.problem) throw new Error(check.problem);
            const up = new THREE.Vector3(...check.up).normalize();
            const upright = new THREE.Quaternion().setFromUnitVectors(up, WORLD_UP);

            // addSplatScenes returns the library's AbortablePromise, whose
            // then() takes no failure callback: awaiting it never settles
            // when a download fails, which would stall this sync loop and
            // every later load. Its .promise is a plain Promise that does
            // reject, so await that (read at once, before anything chains on it).
            try {
                await viewer.addSplatScenes([{
                    path: object.url,
                    format: GaussianSplats3D.SceneFormat.Ply,
                    splatAlphaRemovalThreshold: 5,
                }], true).promise;
            } catch (err) {
                // The header was fine, so the full download or parse failed.
                throw new Error(
                    'The download was interrupted or the file is damaged. Remove the model and add it again.',
                    { cause: err },
                );
            }
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
                    console.warn(`Model ${next.id} failed to load:`, err?.message);
                    failedIdsRef.current.add(next.id);
                    callbacksRef.current.onModelFailed?.(next.id, err?.message || "Couldn't load this model.");
                }
                await removeUnwanted();
            }

            applyTransforms(viewer, loadedRef.current, objectsRef.current);
            const { selectedId: currentId, transformMode: currentMode, snap: currentSnap } = selectionRef.current;
            updateGizmo(viewer, loadedRef.current, objectsRef.current, currentId, currentMode, currentSnap);
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
            const moveSnap = selectionRef.current.snap?.move;
            let position;
            if (moveSnap) {
                // Snapping: step one grid cell (Shift: one metre) along
                // whichever world axis is closest to the camera's direction.
                const direction = forward.clone().multiplyScalar(steps[0]).addScaledVector(right, steps[1]);
                const isAlongX = Math.abs(direction.x) >= Math.abs(direction.z);
                const axisStep = new THREE.Vector3(
                    isAlongX ? Math.sign(direction.x) : 0,
                    0,
                    isAlongX ? 0 : Math.sign(direction.z),
                );
                const step = event.shiftKey ? Math.max(moveSnap, GRID_MAJOR_STEP) : moveSnap;
                position = new THREE.Vector3(...object.position).addScaledVector(axisStep, step);
                position.x = Math.round(position.x / moveSnap) * moveSnap;
                position.z = Math.round(position.z / moveSnap) * moveSnap;
            } else {
                const step = event.shiftKey ? MOVE_STEP * FAST_MOVE_FACTOR : MOVE_STEP;
                position = new THREE.Vector3(...object.position)
                    .addScaledVector(forward, steps[0] * step)
                    .addScaledVector(right, steps[1] * step);
            }
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
        selectionRef.current = { selectedId, transformMode, snap };
        // Transform edits show at once; loads and removals go through sync.
        applyTransforms(viewerRef.current, loadedRef.current, objects);
        updateGizmo(viewerRef.current, loadedRef.current, objects, selectedId, transformMode, snap);
        syncRef.current?.();
    }, [objects, selectedId, transformMode, snap]);

    // Measurements the Scene Builder asks for on demand.
    useImperativeHandle(ref, () => ({
        measureLowestPoint: (objectId) => measureLowestPoint(
            viewerRef.current, loadedRef.current, objectsRef.current, objectId,
        ),
        measureBounds: (objectId) => measureBounds(
            viewerRef.current, loadedRef.current, objectsRef.current, objectId,
        ),
        focusObject: (objectId) => focusObject(
            viewerRef.current, loadedRef.current, objectsRef.current, objectId,
        ),
    }), []);

    useEffect(() => {
        gridRef.current = { visible: showGrid, cellSize: gridCellSize, background };
        applyGrid(viewerRef.current, gridRef.current);
    }, [showGrid, gridCellSize, background]);

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
