# Web app: Scene Builder (`SceneBuilderScreen.jsx`, `SceneViewport.jsx`)

*Authors: Bryan and Xiong Yang.* The Scene Builder arranges finished models (Gaussian splats from `GET /jobs`) into a scene and saves it. **The scene's objects (with their undo history) and its id, name and settings are owned by App**, so the scene survives switching pages. This screen edits them through `onObjectsChange(updater, { mergeKey })` ([useUndoableState](state-hooks.md#useundoablestatejs)) and `onSceneInfoChange`. **A whole field edit, a slider drag, a gizmo drag or a held W/A/S/D key is each one undo step.**

---

## `SceneBuilderScreen.jsx`

### Features
- **Web and phone:** add a model from the library (a searchable dialog: pick a card, then *Add selected model*), select it, move, rotate or scale it with the viewport gizmo, **drop it to the floor**, clean up stray splats with one slider, duplicate, delete, undo and redo, save and reopen.
- **Web only (advanced):** an outliner with hide and load status; an inspector with exact values and keep-proportions scaling; advanced clean-up settings; snapping; splat or point render mode; background colour; screenshot; keyboard shortcuts (**1/2/3** for the transform mode, **W/A/S/D** to slide, **Ctrl+Z / Ctrl+Y**, **Delete**, **Esc**).
- **Phone:** a bottom tool bar, the model list and clean-up in bottom sheets, and a cap on how many models a scene can hold.
- Clean-up, render mode, reset view and screenshots still wait on the engine ([SceneEngine.js](scene-modules.md#sceneenginejs--bridge-to-the-codefine-webassembly-engine-placeholder)). Saving goes through [SceneStorage.js](scene-modules.md#scenestoragejs--saving-and-loading-scenes).

### Constants
`TRANSFORM_MODES` (translate, rotate, scale), `AXIS_LABELS`, scale limits **0.05–20**, `GRID_CELL_SIZE = 0.25 m`, `GRID_SQUARE_SIZE = 1 m`, `GIZMO_SNAP = { move: 0.25, rotateDegrees: 15, scale: 0.05 }`. On phones: `PHONE_MODEL_LIMIT = 4` and `PHONE_SPLAT_BUDGET = 1.5M` splats.

### Helper components and functions
| Name | Behaviour |
|---|---|
| `useIsPhone()`, `clamp`, `tidyNumber(v)` | Helpers. `tidyNumber` rounds so the fields do not show floating-point noise. |
| `getPlyUrl(jobId)` | `/api/v1/jobs/<id>/result.ply`. |
| `isTextEntry(target)` | Keyboard shortcuts are ignored while typing. |
| `AxisFields({ label, values, step, onChange, onEditStart, onEditEnd })` | X, Y and Z number inputs. Focusing a field starts a merge group, and leaving it ends the group. |
| `TrimSlider(...)` | A clean-up slider, with the same edit grouping. |
| **`ModelPickerDialog({ models, modelsStatus, onPick, onClose })`** | A searchable grid of finished models (`ModelCover`). Choose one, then *Add selected model*. |
| **`SceneListDialog({ onOpenScene, onClose })`** | `listScenes()`, each with its object count and date. Delete is `handleDelete` (`deleteScene`). |

### `SceneBuilderScreen` logic
- **Models:** `GET /api/v1/jobs` gives the finished models. `viewportObjects` (memoised) maps scene objects to `{ id, url, position, rotation, scale, isHidden }` for the viewport.
- **Edit grouping:** `editObjects(updater, mergeKey)`, `beginEdit()` and `endEdit()` set `editKeyRef`. `updateObject(id, changes, mergeKey)` and `leaveField()`. `undo()` and `redo()` also mark the scene unsaved.
- `changeSceneInfo(changes)`, `markUnsaved()`.
- **`addModel(model)`**: on phones it refuses past the model limit or the splat budget. Otherwise it calls `createSceneObject`, queues the new object in `pendingFitIdsRef` so it is **fitted to one 1 m grid square once it loads**, and selects it.
- **`fitObjectToGrid(obj, mergeKey)`**: `viewportRef.measureBounds(id)`, then scales so the footprint (the larger of X and Z) is one grid square, and rests the model on the floor.
- `focusObject(obj)`, `focusSelected()`, `fitSelectedToGrid()`.
- **`duplicateSelected()`**: a copy offset by one grid cell. **`deleteSelected()`**, **`toggleHidden(id)`**.
- **`dropSelectedToFloor()`**: `measureLowestPoint(id)`, then moves the object's Y so its base sits on `y = 0`.
- `changeAxis(property, axis, value)` (clamps scale and supports keep-proportions), `changeTrim(setting, value)`.
- **`handleObjectTransform(id, transform, dragSession)`**: gizmo and W/A/S/D updates from the viewport. Each `dragSession` is one merge key, so a whole drag is one undo step.
- **Load reporting:** `handleModelLoadStart(id)`; `handleModelLoaded(id, { splatCount })` (also runs the pending fit-to-grid); `handleModelFailed(id, message)`. `getStatusLabel(obj)` shows *Loading…*, *N splats* or *Failed*.
- **Scenes:** `confirmDiscardChanges()`, `startNewScene()`, **`handleSave()`** (`saveScene`, then stores the returned id and dates and clears the unsaved flag), **`handleOpenScene(id)`** (`loadScene`, **dropping objects whose model no longer exists** and saying so, then `onObjectsReset`), `handleScreenshot()` (engine only).
- `chooseTransformMode(id)`, `openModelPicker()`.
- **Keyboard:** 1/2/3 choose the transform mode, Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z) undo and redo, Delete removes, Esc deselects. All are ignored in text fields.

---

## `SceneViewport.jsx`
An embedded **multi-splat viewport**. It fills its parent and shows **every object at once in one `@mkkellogg/gaussian-splats-3d` viewer**, each with its own position, rotation, scale and visibility.
- The **selected** object gets a three.js **`TransformControls`** gizmo drawn on top of the splats. Dragging the gizmo moves only that object; dragging anywhere else orbits the camera.
- **W/A/S/D** slide the selected object along the ground relative to the camera (`MOVE_STEP = 0.05`, ×5 with Shift). With snapping on, each press steps one grid cell (one metre with Shift) along the nearest world axis. The camera's own W/A/S/D panning is turned off.
- A **sandbox grid** lies on the ground (`y = 0`) with coloured X, Y and Z axes through the origin. It shows even before any model is added.
- The scroll wheel zooms toward the mouse pointer.

### Constants
`WORLD_UP`, `MOVE_KEYS`, `MOVE_STEP`, `FAST_MOVE_FACTOR = 5`. Grid: `GRID_EXTENT = 400` (half-width, inside the camera's 1000 m far plane), `GRID_MAJOR_STEP = 1`, `GRID_OPACITY = { minor: 0.14, major: 0.32, axis: 0.9 }`, `AXIS_COLOURS` (X red, Y green, Z blue), and `GRID_VERTEX_SHADER` / `GRID_FRAGMENT_SHADER`, which draw fine lines every cell, strong lines every metre and the coloured axes, **fading with distance**.

### Private helpers
| Function | Behaviour |
|---|---|
| `isTypingTarget(target)` | The viewer's own keyboard shortcuts are ignored while typing, so typing `-` in a transform field does not shrink the splats. |
| `isDarkColour(hex)` | Picks light or dark grid lines to suit the background. |
| `disposeObject(root)` | Frees the geometries and materials of a three.js subtree. |
| **`createGrid()`** | A shader-drawn floor plane plus a vertical post for the Y axis. |
| **`applyGrid(viewer, { visible, cellSize, background })`** | Shows, hides, resizes or recolours the grid. |
| **`createViewer(container, gizmoHandlers, gridSettings)`** | Creates and starts an **empty** viewer (with its own `threeScene`), the grid, and a `TransformControls` gizmo attached to a **pivot** object that stands in for the selected model. It is drawn in a separate `gizmoScene` after the splats (`drawGizmo`). `gizmoHandlers.onChange(pivot, dragSession)` is called while dragging, and each drag gets its own session number. While no model is loaded the viewer draws nothing itself, so this code moves the camera and draws the grid. |
| `disposeViewer(viewer)` | Stops the viewer, removes its key handler and gizmo, and frees it. It ignores the error that the library's `dispose()` always throws for a viewer that is not a direct child of `<body>`. |
| `scenesMatch(viewer, loaded)` | Whether the viewer's scenes can be read right now (not part-way through a dispose or rebuild). |
| **`updateGizmo(viewer, loaded, objects, selectedId, mode, snap)`** | Puts the gizmo on the selected object (if it is loaded and visible) in the given mode with the snap steps, or hides it. |
| **`applyTransforms(viewer, loaded, objects)`** | Copies each object's transform and visibility onto its splat scene. **Each scene is first turned upright** (its `.ply` *Vertical axis* rotated to +Y), so the rotation and scale fields work in world-up terms. |
| `percentile`, `sampleSplatCentres(scene, matrix)` | Samples at most `MAX_MEASURE_SAMPLES = 200 000` splat centres from large models. |
| `findLoadedScene(...)` | Finds the loaded scene for an object id. |
| **`measureLowestPoint(...)`** | World height of the model's base, using a low percentile (`BASE_PERCENTILE = 0.5%`) of its splat centres, so a few stray splats underneath are ignored. Returns `null` if the model is not loaded. |
| **`measureBounds(...)`** | The model's extent **with its rotation but before its position and scale**, ignoring the outer 1% on each side (`EXTENT_PERCENTILE`). Used to fit a model to the grid. `measureWorldBounds` is the same in world space. |
| `startCameraMove`, `stepCameraMove` | A smooth camera move (`CAMERA_MOVE_SECONDS = 0.45`). Dragging or scrolling cancels it. |
| **`focusObject(...)`** | Moves the camera so the model fills the view (`FOCUS_MARGIN = 1.3`), keeping the current viewing direction, and makes the model's middle the orbit and zoom centre. |

### `SceneViewport(props)`
**Props:** `objects`, `selectedId`, `transformMode`, `snap`, `showGrid`, `gridCellSize`, `background`, `ref` (receives `{ measureLowestPoint, measureBounds, focusObject }` while mounted), `onObjectTransform(id, changes, dragSession)`, `onModelLoadStart(id)`, `onModelLoaded(id, { splatCount })`, `onModelFailed(id, message)`.

It keeps the viewer's scenes in step with `objects`:
- It **loads newly added models one at a time**, because the viewer allows only one load or removal at once. Each load first runs **`checkSplatPly(url)`**, which reads 4 KB and gives a clear message if the file cannot be used (signed out, deleted, not a splat, …), and computes the upright rotation. A damaged or interrupted download gets its own message.
- It **removes models that were deleted** and updates transforms whenever `objects` changes.
- **A failed model is not retried while it stays in the scene.** Removing it and bringing it back (for example by undo) retries.
- It reports gizmo drags and W/A/S/D moves through `onObjectTransform`.

### `SafeSceneViewport(props)` *(default export)*
Wraps `SceneViewport` in an **error boundary**, so an error in the viewport shows a *"Reload viewport"* message there instead of blanking the whole app.
