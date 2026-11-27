# Web app: Scene Builder support modules (`SceneEngine.js`, `SceneStorage.js`)

*Author: Bryan.* These modules sit between the Scene Builder screen ([SceneBuilderScreen / SceneViewport](scene-builder.md)) and, respectively, the 3D engine and the scene store. The screen calls only these functions, so the parts behind them can change without touching the UI.

---

## `SceneEngine.js`: bridge to the Codefine WebAssembly engine (placeholder)
The web engine ([engine/web](../../engine/web/WebMain.md)) currently exports loading and camera controls only (`cf_init`, `cf_load_ply`, `cf_orbit`, `cf_pan`, `cf_zoom`). Every function here that needs a new export is marked `TODO(engine)` in the code, naming the `cf_` function it expects. **`SCENE_ENGINE_AVAILABLE = false`**, so `isSceneEngineReady()` returns false and every function below returns straight away with a neutral value. The Scene Builder currently draws its 3D view with three.js instead ([SceneViewport](scene-builder.md#sceneviewportjsx)).

| Function | Intended job, once wired up |
|---|---|
| `isSceneEngineReady()` | `SCENE_ENGINE_AVAILABLE && isStarted`. |
| `startSceneEngine(canvas)` / `stopSceneEngine()` | Create or destroy the engine on the canvas. |
| `addSceneModel(objectId, plyUrl)` | Load a model and return its splat count (0 for now). |
| `removeSceneModel(objectId)` | Remove a model. |
| `setSceneTransform(objectId, transform)` | Position, rotation and scale. |
| `setSceneVisible(objectId, isVisible)` | Visibility. |
| `setSceneTrim(objectId, trim)` | Per-object trim. |
| `pickSceneObject(x, y)` | Click picking, returning an object id or `null`. |
| `measureLowestPoint(objectId)` | For "drop to floor". |
| `setSceneBackground(hex)`, `setSceneRenderMode(mode)` | Scene look. |
| `orbitSceneCamera`, `panSceneCamera`, `zoomSceneCamera`, `resetSceneCamera` | Camera control. |
| `renderSceneFrame(w, h)`, `getSceneSplatCount()`, `captureSceneScreenshot()` | Drawing, stats and thumbnails. |

---

## `SceneStorage.js`: saving and loading scenes
A scene is a small JSON record: `{ id, name, createdAt, updatedAt, background, renderMode, objects[] }`, where each object is `{ objectId, jobId, name, position, rotation, scale, trim, isHidden }`. The models themselves stay in `/jobs`.

**`SCENES_API_READY = false`**, so scenes are currently kept in this browser's **`localStorage`** under `genesis.scenes`, which is format version 0. The backend **does** now provide `GET/POST /api/v1/scenes` and `GET/PUT/DELETE /scenes/:id` ([routes/feedback-scenes](../../backend/routes/feedback-scenes.md)), and converts version-0 scenes when they are saved, so switching this flag to `true` moves storage to the server. `SCENES_SAVED_ON_SERVER` exports the flag so the UI can say where scenes are kept.

| Function | Behaviour |
|---|---|
| `makeObjectId()` | `object-<time base36>-<random>`. |
| **`createSceneObject(model, objects)`** | A new object at the origin with identity rotation and scale, default trim, and visible. **Repeated copies of one model are named `Name (2)`, `Name (3)`, …** Used by *Add model* and by the model page's *Add to scene*. |
| `NEW_SCENE_INFO` | `{ id: null, name: 'Untitled scene', background: '#18181b', renderMode: 'splats', hasUnsavedChanges: false }`. |
| `readLocalScenes()` / `writeLocalScenes(scenes)` *(private)* | `localStorage` wrapped in `try`. Write returns false if storage is blocked. |
| `makeSceneId()` *(private)* | `scene-<time>-<random>`. |
| `requestJson(url, options)` *(private)* | `fetch` with a JSON content type. Throws on a non-OK status, and returns `null` for 204. |
| `listScenes()` | Server, or local summaries `{ id, name, updatedAt, objectCount }` newest first. |
| `loadScene(id)` | Server, or the local copy (throws *"Scene not found."*). |
| `saveScene(scene)` | Server: POST for a new scene, PUT for an existing one. Local: keeps `createdAt` for an existing scene, sets `updatedAt` to now, upserts, and throws *"This browser blocked saving."* on failure. Returns the saved scene. |
| `deleteScene(id)` | Server DELETE, or removes the local copy. |
