# `ui/MainWindow.h` / `MainWindow.cpp`

The **editor shell** (window title *Genesis Alpha Build*). The 3D [Viewport](Viewport.md) sits in the centre, surrounded by the menu bar, the main toolbar, the status bar and the dockable panels: **Scene** ([Outliner](OutlinerPanel.md)), [Inspector](InspectorPanel.md), [Assets](AssetBrowserPanel.md), [My Models](RemoteModelsPanel.md), [Console](ConsolePanel.md) and [Stress Test](StressTestPanel.md) (developer mode only).

MainWindow owns the scene-editing commands and the **undo stack**. It builds models on this PC through [LocalReconstruction](../pipeline/LocalReconstruction.md), loads, exports and converts `.ply` files and saves and opens [`.gscene` scenes](../scene/SceneFile.md) on **worker threads**, accepts `.ply` and `.gscene` drag-and-drop, runs the stress tests, and saves the layout and preferences with `QSettings`.

## Constants and helpers (anonymous namespace)
- `kStatsRefreshMs = 250` (status-bar fps refresh), `kStatusMessageMs = 5000`, `kMaxRecentFiles = 8`.
- **`kLayoutVersion = 2`**: increase this when docks are added, removed or renamed, so an out-of-date saved layout is ignored instead of restoring a broken arrangement.
- QSettings keys: `window/geometry`, `window/layout`, `assets/folder`, `files/recent`, `view/renderMode`, `view/statsOverlay`, `view/grid`, `files/trimOnImport`, `trim/minAlpha|cropPct|voxelDivisions|minPerVoxel`, `files/exportFolder`, `files/sceneFolder`.
- `kSceneFilter`: the *Genesis scene (*.gscene)* file-dialog filter.
- **`IsPlyFile(path)`**, **`RenderModeName(mode)`**.
- **`BuildPhaseLabel(phase)`**: the web app's step names (`PHASE_LABELS` in `Processing.jsx`). For example `colmap-mapping` becomes *Recovering camera positions*.
- **`ElapsedText(ms)`**: formats as `m:ss`.

## Construction

### `MainWindow()`
1. Window setup: 1440×860, drops accepted, animated, nested and tabbed docks, tabs on top.
2. **Creates the `ConsolePanel` first**, so it captures output from everything built after it.
3. Creates the `BackendClient` and the `LocalReconstruction` (connected to `onBuildStatus` and `onBuildFinished`), plus a 1-second `m_buildTick` timer. COLMAP can stay quiet for minutes, so the timer keeps the elapsed time moving.
4. Creates the Viewport, then `createActions`, `createMenus`, `createToolBar`, `createDocks`, `createStatusBar`.
5. Saves the default layout (for *Reset Layout*), calls `restoreSettings()`, then `updateDevModeAction()` (restoring the layout can bring back the dev dock's visibility, so dev mode is applied again).
6. Wires the viewport callbacks:
   - `onTransformEdited` pushes a `MoveModelCommand` (one finished gizmo drag or nudge is one undo step);
   - `onCropBoxEdited` calls `commitCropBoxEdit`;
   - `metrics().onRecordingFinished` defers `showRecordingSummary` with `singleShot(0)`, because it fires inside `paintGL`;
   - `onInitialized` applies the render mode, overlay and grid settings, refreshes the panels, starts any imports that were queued before the renderer existed, and opens a scene passed on the command line (`m_pendingScenePath`);
   - `onStats` runs every frame: `m_inspector->syncFromModel()` and `setCropState(...)`. Every 250 ms it also updates the fps and *"N models | M splats"* labels.
7. Connects `sessionChanged` to `updateAccountActions` and calls `m_backend->restoreSession()`.

### `~MainWindow()`
**Waits for** any running load, export, `.obj` copy or scene save/open thread before deleting it. A running `QThread` must never be destroyed.

### `createActions()` *(private)*
Creates every `QAction`:
| Action | Shortcut | Does |
|---|---|---|
| New Scene | Ctrl+N | `newScene()`. |
| Open Scene… | Ctrl+Shift+O | `openScene()`. |
| Save Scene | Ctrl+S | `saveScene(false)`. Disabled until a model is loaded. |
| Save Scene As… | Ctrl+Shift+S | `saveScene(true)`. Disabled until a model is loaded. |
| Import Splat… | Ctrl+O | File dialog (multi-select), `importSplat` for each file. |
| Export… | Ctrl+E | `exportModels()`. Disabled until a model is loaded. |
| Generate Model… | Ctrl+G | `showGenerateDialog()`. |
| Exit | Ctrl+Q | `close()`. |
| Rename | F2 | Shows and raises the Scene dock, then `editSelectedName()`. |
| Delete | Backspace | With a crop box up: `applyCropBox()`; otherwise `deleteSelectedModel()`. |
| Add Crop Box | Ctrl+B | `toggleCropBox()`. |
| Apply / Confirm Crop Box | Enter (viewport only) | `confirmCropRegion()` in contents mode, otherwise `applyCropBox()`. |
| Crop Box Removes Inside | (checkable) | Sets `cropBox().removeInside`. |
| Crop Box Moves Contents | Ctrl+Shift+B | Sets `moveContents`. Leaving contents mode clears the confirmed selection. |
| Hide/Show Model | Ctrl+H | `toggleModelHidden(selected)`. |
| Deselect | Esc (viewport only) | Closes the crop box first. A second press deselects. |
| Reset Position | — | Pushes a `MoveModelCommand` that zeroes the translation. |
| Undo / Redo | Ctrl+Z / Ctrl+Y | From `m_undo.createUndoAction/RedoAction`. The text follows the top command (*"Undo Move Cube"*). |
| Point Cloud / Gaussian Splat | Ctrl+1 / Ctrl+2 | Exclusive group, calls `setRenderMode`. |
| Recenter Camera | Home (viewport only) | `m_viewport->recenterCamera()`. |
| Stats Overlay | (checkable) | `setShowImGuiStats`. |
| Record Metrics | Ctrl+Shift+R | `setMetricsRecording(on)`. |
| Show Grid | Ctrl+Shift+G | `setShowGrid`. |
| Trim Splats on Import | (checkable) | Read by `startNextImport`. |
| Sign In… / Sign Out | — | `showSignIn()` / `m_backend->signOut()`. |
| Trim Settings… | — | `showTrimDialog()`. |
| Developer Mode: On/Off | (checkable) | `toggleDevMode()`. |
| Reset Layout | — | Restores the default layout, then applies dev mode again. |

Esc, Home and Enter use `Qt::WidgetShortcut` on the viewport, so they never take keys from text fields in the panels. `QUndoStack::indexChanged` triggers a deferred `refreshScenePanels()` after every undo or redo.

### `createMenus()` *(private)*
- **File:** New Scene, Open Scene, Save Scene, Save Scene As, then Import, Trim on Import, Open Recent, Generate, Export, Exit.
- **Edit:** Undo/Redo, Rename/Delete/Hide, Reset Position/Deselect, the crop-box actions, Trim Settings, Developer Mode.
- **View:** Render Mode submenu, Recenter, Stats Overlay, Record Metrics, Show Grid.
- **Account:** an info label, Sign In, Sign Out.
- **Window:** filled in by `createDocks`.
- **Help:** Controls (F1), About, About Qt.

### `createToolBar()` *(private)*
A fixed toolbar with text beside icons: Import, Generate, Export | *Render:* Point Cloud, Gaussian | Recenter, Stats, Record, Grid | Delete.

### `addPanelDock(title, objectName, panel, area)` *(private)*
Wraps a panel in a `QDockWidget`, sets the `objectName` that `saveState`/`restoreState` require, adds it, and records it in `m_docks`.

### `createDocks()` *(private)*
- The side docks take all four corners, so they run the full window height.
- Scene on the left, Inspector on the right. Assets, My Models, Console and Stress Test are tabbed together at the bottom, with Assets in front. Initial sizes are set.
- **`runStressTest(name, test)`** lambda: `beginStressRun(false)`, then a `StressTestRunner` whose `onStep` writes the step to the status bar and calls `repaint()` straight away (events are deliberately **not** processed, because that would draw viewport frames in the middle of a test and disturb the timings). It runs the test, adds the results to the panel (or reports that the test was skipped), warns in the status bar and Console about failed steps, and finishes with `endStressRun()`. Load and Delete also select the new model or refresh the panels afterwards.
- The **Window** menu gets a show/hide toggle for each dock and the toolbar, plus *Reset Layout*.
- **Panel → command wiring:**
  - Assets/My Models `importRequested` → `importSplat`;
  - My Models `signInRequested` → `showSignIn`;
  - Outliner select / rename / delete / toggle-hidden / export → the matching methods;
  - Inspector trim apply / untrim → `applyModelTrim` / `untrimModel`;
  - `transformEdited` → a `MoveModelCommand`; `transformFieldEdited` → a **mergeable** `MoveModelCommand`;
  - `resetPositionRequested` → triggers the action;
  - the crop toggle / mode / apply → the same actions, so the menu checkmarks stay in step with the buttons;
  - `nameChanged` → `renameModel`.

### `createStatusBar()` *(private)*
Adds permanent widgets: the build label, bar and *Cancel Build* button; the import label and an indeterminate bar (happly reports no progress); the scene label; the render-mode label; the fps label.

## Persistence

### `restoreSettings()` / `saveSettings() const`
Restore and save window geometry, the dock layout (with the version), the Assets folder, render mode, stats overlay, grid, trim-on-import, the four default trim values (also passed to the Inspector) and the recent files.

### `closeEvent(QCloseEvent*)`
If a local build is running, it asks first, because quitting stops the build and nothing is kept. It then saves the settings and clears the import queue.

## Import pipeline

### `openFiles(const QStringList&)`
Imports each `.ply` path, for example from the command line, opens a `.gscene` (`openScenePath`, or kept in `m_pendingScenePath` until `onInitialized` if the renderer does not exist yet), and warns about anything else. It is safe to call before the renderer exists.

### `dragEnterEvent` / `dropEvent`
Accept local `.ply` and `.gscene` URLs. The drop is handled on the next event-loop pass (opening a scene can show a dialog): each `.ply` is imported and each `.gscene` opened.

### `importSplat(path)` *(private)*
If the file is missing, it warns and removes it from Recent. Otherwise it adds it to `m_pendingImports` and calls `startNextImport()`.

### `startNextImport()` *(private)*
Does nothing while a load or a scene save/open is running, the queue is empty, or the renderer is not ready (the scene thread calls it again when it finishes). If the scene already holds **32 models**, it drops the whole queue with a *Scene Full* warning. Otherwise it takes the next path, shows the busy state, and on a **worker `QThread`** calls `LoadSplatPly`, then (if *Trim on Import* is on) `TrimSplats` with the default settings. The trimmed result is kept only if it is not empty **and** actually smaller; the untrimmed data is moved into `original`. When the thread finishes it calls `finishImport(...)` and then `startNextImport()`.

### `finishImport(path, splats, original, trimData)` *(private)*
If no splats were loaded, it shows a status message and a dialog explaining the required 3DGS fields. Otherwise it calls `renderer->SetSplats(splats, fileName)`, adds the file to Recent (unless it is a cached download), stores the original and trim state on the new model, selects it, refreshes the panels, and logs *"Imported X (N splats, trimmed A of B)"*.

## Scene commands (private)

| Function | Behaviour |
|---|---|
| `selectModel(i)` | Clears the confirmed splat selection **only when a different model is selected** (`refreshScenePanels` selects the same model again after every edit). Selects the model, points the Inspector at it, and enables Rename, Delete, Hide, Reset and Deselect. |
| `renameModel(i, name)` | Pushes a `RenameModelCommand` if the name changed. The panel refresh is **deferred**, because this can be called from inside the outliner's own edit commit. |
| `toggleModelHidden(i)` | `SetModelHidden(!hidden)`, then a deferred refresh and a status message. |
| `deleteSelectedModel()` | Clears the Inspector pointer and `m_cropBoxModel` (the memory address may be reused), clears the selection, **clears the undo stack**, calls `RemoveModel`, refreshes. Not undoable. |
| `setRenderMode(mode)` | Checks the matching action, updates the status label and sets the renderer mode. |
| `refreshScenePanels()` | `m_outliner->rebuild`, `selectModel(current)`, and enables Export when there are models and no export is running. Enables Save Scene / Save Scene As when there are models, and all four scene actions only while no scene save/open is running. |
| `setImportBusy(name)` | Shows or hides the import label and bar, and sets the busy cursor. |

### Crop box
- **`toggleCropBox()`**: hides the box if it is active. Otherwise it needs a selected model. The box is **fitted only the first time, or for a different model** (`FitCropBoxToSplats`); otherwise it keeps its last size and position. It applies *Removes Inside* and activates the box.
- **`cancelCropBox()`**: hides the box and clears the splat selection.
- **`confirmCropRegion()`** (contents mode): does nothing during a drag or nudge, because releasing then would lose the preview. If a selection exists, it releases it. Otherwise it collects the splats inside the box (`CollectSplatsInBox`) and calls `SetSelection`.
- **`commitCropBoxEdit(before, after)`**: called when a box drag or nudge ends. If no confirmed selection on the selected model is being carried, it pushes a `MoveCropBoxCommand`. Otherwise it builds a single undo step: a `MoveCropBoxCommand` named *"Move N Splats"* with a **child** `MoveSplatsCommand` that uses `WorldDeltaToModelSpace(after · inverse(before), model)`.
- **`applyCropBox()`**: builds a keep mask from the **confirmed selection** if one exists (even if the box has since moved), otherwise from `ComputeCropKeepMask`. **If every splat would be removed**, it cancels the box, clears the undo stack and pushes an undoable `DeleteModelCommand` instead (its `beforeRemove` drops the Inspector and crop-box pointers). Otherwise it pushes a `RemoveSplatsCommand`, or reports that the box selects nothing.

### Trim
- **`showTrimDialog()`**: opens a non-modal [TrimDialog](TrimDialog.md) that deletes itself on close.
- **`applyDefaultTrim(trim)`**: saves the global defaults and passes them to the Inspector.
- **`applyModelTrim(trim)`**: `KeepOriginal()`, then **always trims from the untrimmed source**, so loosening the values brings detail back. It refuses a result with no splats left. It clears the undo stack (earlier removals refer to the old list) and the selection, then calls `UpdateModel` and `SetTrimData(trim, kept < total)` and refreshes.
- **`untrimModel()`**: restores `SourceSplats()` and marks the model as not trimmed. The original stays stored, so the model can be trimmed again.

### Export
**`exportModels()`**: opens the [ExportDialog](ExportDialog.md), then a save dialog suggesting `<model>.<ext>` or `scene.<ext>` in the last export folder (adding the extension if missing). It **copies the splats and transforms** of the chosen models, because the user can edit the scene while the export runs, and calls `ExportSplats` on a worker thread. When it finishes it shows a warning dialog or a summary (splats, triangles, file size).

### Scene files
Scenes are `.gscene` files written and read by [SceneFile](../scene/SceneFile.md). `m_scenePath` holds the open scene (empty until it is saved or opened) and `m_sceneThread` the running save or open. While that thread runs, the four scene actions are disabled and new imports wait in the queue.
- **`saveScene(saveAs)`**: needs at least one model. Uses `m_scenePath`, or asks for a file name (Save As, or a scene never saved) in the last scene folder (`files/sceneFolder`, default *Documents*), adding `.gscene` if missing. It **copies** every model's name, splats, transform, hidden flag and trim values, plus the untrimmed splats of a trimmed model, so the user can keep editing while `SaveScene` runs on a worker thread. On success it stores the path and updates the title; on failure it shows the error.
- **`openScene()`**: a file dialog in the last scene folder, then `openScenePath`.
- **`openScenePath(path)`**: before the renderer exists, keeps the path for `onInitialized`. Refuses while a scene save/open or an import is running, or if the file is missing. Asks before replacing a scene that has models (`confirmReplaceScene`). `LoadScene` runs on a worker thread, so the current scene stays as it is until the new one has loaded (and is kept if loading fails). Then `clearScene()`, and for each model `SetSplats`, `SetTransform`, `SetOriginal` / `SetTrimData` and `SetModelHidden`, up to the 32-model limit. It applies the saved render mode, deselects, updates the title and lists any warnings (missing files, models over the limit) in one dialog.
- **`newScene()`**: refuses while imports are running, asks (`confirmReplaceScene`), then `clearScene()` and forgets `m_scenePath`.
- **`clearScene()`**: cancels the crop box, drops the Inspector and crop-box pointers, **clears the undo stack** (its commands point at the models), and removes every model.
- **`confirmReplaceScene(action)`**: a Yes/Cancel question naming how many models will be removed; true straight away when the scene is empty.
- **`updateWindowTitle()`**: *"<scene name> - Genesis Alpha Build"*, or just the app title for an unsaved scene.

There is no unsaved-changes tracking: opening a scene, starting a new one or quitting does not know whether the scene changed since the last save, so `confirmReplaceScene` always asks when there are models.

### Metrics recording
- **`setMetricsRecording(on)`**: *off* calls `StopRecording()`, and the results dialog opens later. *On* calls `StartRecording()`. On `StillSaving` or an error it unchecks the action **with signals blocked**, so this function is not entered again, and reports why.
- **`showRecordingSummary(summary)`**: unchecks the action and builds a rich-text table (average fps, duration, 1% low and slowest second, avg/p95/p99/max frame time, drops as a percentage, splat range, refresh rate, pauses). It opens a **non-modal** box with *Open Dashboard* (`http://localhost:<METRICS_PORT or 5010>/#/engine/<id>`) and *Show Folder*.

## Local model build (private)
- **`showGenerateDialog()`**: refuses if a build is already running. Otherwise it runs the [GenerateModelDialog](GenerateModelDialog.md), stores the follow-up and name, starts the clock and the busy UI, and calls `m_localBuild->start(request, copyFolder)`.
- **`onBuildStatus(status)`**: ignores finished states. Otherwise it shows *"<name>: <phase label> (<detail>)"* and a 0–1000 progress bar.
- **`onBuildFinished(path, error)`**: *Cancelled.* gives a status message only. An error gives a warning and a dialog with the log path. On success it logs the elapsed time. Then, if an `.obj` copy was requested, it calls `saveGeneratedObj` (which also imports from the same read of the file); otherwise, if *Import* was chosen, `importSplat(path)`.
- **`cancelBuild()`**: asks for confirmation, then `m_localBuild->cancel()`.
- **`setBuildBusy(busy)`** / **`refreshBuildLabel()`**: show or hide the build widgets and the tick timer; append `| m:ss elapsed`.
- **`saveGeneratedObj(plyPath, followUp)`**: one copy at a time; if one is already running it skips the `.obj` but still imports. It picks a free name `<model>.obj` or `<model> (N).obj` next to the `.ply`. On a worker thread it calls `LoadSplatPly`, then `ExportSplats` to OBJ points or mesh, **then trims for the import**, so the `.obj` keeps every splat. When it finishes it imports the splats it already read (`finishImport`), falling back to the import queue if the renderer is not ready or the scene is full, and reports the save result.

## Stress-test harness (private)
- **`eventFilter(watched, event)`**: installed only while a stress test runs. It **swallows** shortcuts, closing the main window, and key, mouse, wheel, context-menu and drag events aimed at anything other than the Stress Test panel, so nothing can change the scene in the middle of a test.
- **`beginStressRun(stoppable)`**: sets the flags, installs the filter on `qApp`, calls `SetRunning(true, stoppable)`.
- **`endStressRun()`**: calls `processEvents()` **while the filter is still installed**, so input queued during the test is delivered and dropped, then removes the filter and re-enables the panel.
- **`runAllStressTests(onCurrent)`**: the order is Load, Select, Move, Trim, Undo/Redo, Export, Delete. Load comes first because it adds the sphere the other tests work on; Delete comes last because it adds and removes a model. In *Current* mode a model must be selected, and Load becomes `TestLoadCopy` (a failure there does not stop the run). Between tests it updates *"Test All: running X (i of 7)"*, calls `processEvents()` so a click on **Stop** can get through, and checks `m_stopStressTests`. If the sphere Load test is skipped, the whole run is cancelled. After Load it selects the new sphere. It ends with a grand-total row (marked *stopped*, *N failed*, and the target model as needed) and a status and Console summary.

## Developer mode
- **`toggleDevMode()`**: flips `m_devMode`.
- **`updateDevModeAction()`**: sets the action text and shows or hides the Stress Test dock **and its Window-menu entry**. It is safe to call before the dock exists.

## Recent files, account, help (private)
- **`addRecentFile(path)`**: moves the absolute path to the front, keeping at most 8. **`rebuildRecentMenu()`**: numbered entries `&1 name…`, *Clear Recent*, or *(none)*.
- **`showSignIn()`**: runs the [LoginDialog](LoginDialog.md). On success it shows and raises the My Models dock.
- **`updateAccountActions()`**: *"Signed in as email (admin)"* or *"Not signed in"*, and enables Sign In or Sign Out to match.
- **`showControls()`**: a rich-text table of every mouse and keyboard control. **`showAbout()`**: the app title, a description, the team, and the Qt version.

> `generateStressTestSphere()` is declared in the header but not defined in `MainWindow.cpp`. The stress sphere is generated through `StressTestRunner::TestLoad` instead.
