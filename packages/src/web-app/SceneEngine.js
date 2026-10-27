/*!************************************************************************
\file SceneEngine.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 21-10-2026
\brief
Bridge between the Scene Builder UI and the Codefine engine (WebAssembly,
see engine/web). The UI only calls the functions in this file, so wiring up
the engine later means filling these in without touching the screen.

PLACEHOLDER: the web engine currently loads a single model with camera
controls only (cf_init, cf_load_ply, cf_orbit, cf_pan, cf_zoom). Every
function below that needs a new export is marked TODO(engine) with the
cf_ function it expects. Until then isSceneEngineReady() returns false and
the Scene Builder shows its top-down placeholder map instead.
**************************************************************************/

// Flip to true once engine/web/WebMain.cpp exports the scene functions below.
const SCENE_ENGINE_AVAILABLE = false;

let isStarted = false;

export function isSceneEngineReady() {
    return SCENE_ENGINE_AVAILABLE && isStarted;
}

// Starts the engine on the given canvas. Resolves true when it is running.
// TODO(engine): load the module with loadEngineFactory() from codefineEngine.js
// and call cf_init('#<canvas id>'), the same way EngineSplatViewer.jsx does.
// Needs the engine to keep several models loaded at once.
export async function startSceneEngine(canvas) {
    if (!SCENE_ENGINE_AVAILABLE || !canvas) return false;
    isStarted = true;
    return true;
}

// TODO(engine): cf_shutdown()
export function stopSceneEngine() {
    isStarted = false;
}

// Downloads the .ply at plyUrl and adds it to the scene under objectId.
// Resolves to the number of splats loaded (0 if it failed).
// TODO(engine): cf_add_model(objectId, data, size) -> splat count.
// cf_load_ply currently replaces the one loaded model.
export async function addSceneModel(objectId, plyUrl) {
    if (!isSceneEngineReady()) return 0;
    void objectId;
    void plyUrl;
    return 0;
}

// TODO(engine): cf_remove_model(objectId)
export function removeSceneModel(objectId) {
    if (!isSceneEngineReady()) return;
    void objectId;
}

// position in metres, rotation in degrees (X, Y, Z), scale per axis.
// TODO(engine): cf_set_transform(objectId, px, py, pz, rx, ry, rz, sx, sy, sz)
// building the matrix the same way InspectorPanel.cpp does for SplatModel::SetTransform.
export function setSceneTransform(objectId, transform) {
    if (!isSceneEngineReady()) return;
    void objectId;
    void transform;
}

// TODO(engine): cf_set_visible(objectId, isVisible)
export function setSceneVisible(objectId, isVisible) {
    if (!isSceneEngineReady()) return;
    void objectId;
    void isVisible;
}

// trim = { strength, minOpacity, maxSplatSize, density }, all 0..1.
// strength drives MakeDefaultTrimmerParams(); the other three override
// minAlpha, maxSize and minPerVoxel in SplatTrimmerParam when above 0.
// TODO(engine): cf_set_trim(objectId, strength, minOpacity, maxSplatSize, density)
// using SplatTrimmer's ComputeKeepMask so it can be undone (no data lost).
export function setSceneTrim(objectId, trim) {
    if (!isSceneEngineReady()) return;
    void objectId;
    void trim;
}

// Returns the objectId under the canvas pixel (x, y), or null for empty space.
// TODO(engine): cf_pick(x, y) -> objectId
export function pickSceneObject(canvasX, canvasY) {
    if (!isSceneEngineReady()) return null;
    void canvasX;
    void canvasY;
    return null;
}

// Height of the object's lowest kept splat in world space, used by
// "Drop to floor". Returns null when the engine can't tell yet.
// TODO(engine): cf_lowest_point(objectId) -> world Y
export function measureLowestPoint(objectId) {
    if (!isSceneEngineReady()) return null;
    void objectId;
    return null;
}

// TODO(engine): cf_set_background(r, g, b)
export function setSceneBackground(hexColour) {
    if (!isSceneEngineReady()) return;
    void hexColour;
}

// 'splats' or 'points'. cf_set_render_mode already exists (1 = gaussian, 0 = points).
export function setSceneRenderMode(renderMode) {
    if (!isSceneEngineReady()) return;
    void renderMode;
}

// cf_orbit / cf_pan / cf_zoom / cf_reset_camera already exist.
export function orbitSceneCamera(deltaX, deltaY) {
    if (!isSceneEngineReady()) return;
    void deltaX;
    void deltaY;
}

export function panSceneCamera(deltaX, deltaY) {
    if (!isSceneEngineReady()) return;
    void deltaX;
    void deltaY;
}

export function zoomSceneCamera(notches) {
    if (!isSceneEngineReady()) return;
    void notches;
}

export function resetSceneCamera() {
    if (!isSceneEngineReady()) return;
}

// Draws one frame at the canvas size. Called from the screen's render loop.
// cf_render(width, height) already exists.
export function renderSceneFrame(width, height) {
    if (!isSceneEngineReady()) return;
    void width;
    void height;
}

// Total splats across visible objects, used for the phone splat budget.
// TODO(engine): cf_splat_count() currently counts the single model only.
export function getSceneSplatCount() {
    if (!isSceneEngineReady()) return 0;
    return 0;
}

// Resolves to a PNG Blob of the current view, or null if not available.
// TODO(engine): render one frame then canvas.toBlob(); needs the WebGL context
// created with preserveDrawingBuffer, or the capture taken right after cf_render.
export async function captureSceneScreenshot() {
    if (!isSceneEngineReady()) return null;
    return null;
}