# `ui/Viewport.h` / `Viewport.cpp`

The 3D view, a `QOpenGLWidget`. It owns the OpenGL context, the [SplatRenderer](../splat/SplatRenderer.md), the orbit [Camera](../gfx/Camera.md), the [InputManager](../Manager/InputManager.md), the grid and crop-box renderers, the [FrameMetrics](../metrics/FrameMetrics.md) recorder and the ImGui overlay (tool buttons, stats, gizmo, grid labels and the REC indicator). It **repaints continuously**, paced by vsync, which replaced the old GLFW main loop. Scene editing (import, selection, inspector edits) comes from the Qt panels through `renderer()`. The gizmo and nudges are handled here and reported back through callbacks.

## Callbacks (engine → Qt UI)
| Member | When it fires |
|---|---|
| `onStats(fps, splatCount)` | Every frame. |
| `onInitialized()` | Once the GL context and the renderer exist. |
| `onTransformEdited(model, before, after)` | Once, when a gizmo drag or nudge burst on a **model** ends. Not once per frame. |
| `onCropBoxEdited(before, after)` | The same, for the **crop box**. |

## Public functions
| Function | Purpose |
|---|---|
| `Viewport(parent)` | Strong focus, and mouse tracking on, because ImGui needs hover positions and not just drags. |
| `~Viewport()` | Makes the context current, detaches `onRecordingFinished`, calls `m_metrics.Shutdown()` (saves a running recording and frees the GPU queries), frees the renderers, shuts down ImGui, and releases the context. |
| `setShowImGuiStats(bool)` / `setShowGrid(bool)` | Overlay toggles. |
| `renderer()` | The scene renderer. **Null until the GL context exists.** |
| `cropBox()` | The `CropBox`. While it is active, the gizmo edits the box instead of the model. |
| `isBoxEditInProgress()` | True during a gizmo drag or nudge burst, whose move is committed only when it ends. |
| `recenterCamera()` | `m_camera.ResetPosition()`. |
| `metrics()` | Lets the editor start and stop recordings. |
| `RenderFrameBlocking()` | Calls `repaint()` (which runs `paintGL` synchronously), then `glFinish()`, so the stress tests can time work the renderer defers to its next draw. |

## GL setup and frame loop

### `initializeGL()`
Runs `glewInit` (failure throws `runtime_error`). Turns on depth testing, program point size and alpha blending. Creates the splat, crop-box and grid renderers and calls `BindInputs()`. Creates the ImGui context with **`imgui.ini` in the user data folder**, because an installed copy's working folder is often read-only. Initialises the Qt and OpenGL3 backends (`#version 330`) and `m_metrics.Init(<user data>/metrics)`. Starts the frame timer and calls `onInitialized`.

### `BindInputs()` *(private)*
- Left click goes to `Camera::ProcessLeftClick` (pan), right click to `ProcessRightClick` (orbit), scroll to `ProcessScroll` (zoom).
- The arrow keys (FORWARD/BACKSWARD/LEFT/RIGHT) call `Nudge` with **+X, −X, −Z, +Z**.

### `paintGL()`
1. `m_metrics.BeginFrame(screen refresh rate)`. Calculates delta time and fps and the framebuffer size (including the device pixel ratio). Clears to a dark blue-grey.
2. **Scene section (CPU and GPU timed):** the grid (if shown) is drawn **first**, so models blend over it; then `renderer->Draw(view, proj, fbW, fbH, camPos)`; then the crop box if active. The box is **green** when *Move contents* is on, **orange** when removing the inside, and **blue** when keeping the inside.
3. **Overlay section:** a new ImGui frame, then `DrawGridLabels`, `DrawGizmo`, `DrawToolButtons`, `DrawImGui(fps)` and `DrawRecordingIndicator`, then render.
4. `ReportMetricsActivity()`, then `EndFrame(total splats, models)`, then `onStats`.
5. `update()` schedules the next frame.

## Gizmo

### `DrawGizmo(view, proj)` *(private)*
- `ImGuizmo::BeginFrame()` runs every frame, to keep hover and active state up to date.
- **Target:** the crop box if it is active, otherwise the selected model.
- **Changing tool in the middle of a drag** ends the drag where it is (`FinishGizmoDrag`) and **locks** the gizmo until the mouse button is released, so continuing to hold the button (or switching back) cannot move the target further.
- With no target (no model, or a hidden one, and no box) or in **Pan** mode, it resets the drag state and clears the region preview. If a nudge is carrying the contents, the preview is left alone, so the carried splats stay visible while the arrow keys are held.
- The operation follows the tool (translate, rotate, scale). The crop box rotates and scales in **local** space so it can be fitted to a rotated region; everything else uses world space.
- `ImGuizmo::Manipulate(...)` writes the new matrix to the box or model **as the drag happens**.
- **Drag start** (`IsUsing` changes to true): a running nudge is committed first and ends exactly at `original`, then the gizmo's first-frame change is re-applied, so no part of the move is reported by both. It then records the drag target, `m_dragBefore = original`, whether a confirmed selection is being carried (`moveContents && HasSelection()`), and the tool.
- **Drag end:** `FinishGizmoDrag`.
- While dragging with carried contents, it calls `renderer->SetRegionPreview(box · inverse(before))`. The splat data itself changes only once the drag ends.

### `FinishGizmoDrag(model, editingBox)` *(private)*
Reports the whole drag as **one undo step**: `onCropBoxEdited(before, after)` for the box, or `onTransformEdited(model, before, after)` if the model still matches and actually moved. Each report is wrapped in `FrameMetrics::ScopedCommit`. It then resets the drag state and clears the region preview, because by now the callback has baked the move into the splat data.

## Nudging

### `Nudge(type, direction)` *(private)*
- **Release:** decrements `m_nudgeKeysDown`. The last nudge key coming up calls `FinishNudge()`.
- **Target:** the crop box if active, otherwise the selected model. With no target it returns.
- **During a gizmo drag** nudges are ignored, but presses are still counted, because those keys are down and their release must close a later nudge.
- If the target changed in the middle of a burst (the box was shown or hidden, or another model was selected), it finishes the old burst first and keeps the key count.
- **Burst start:** records the target and its starting transform, and whether a confirmed selection is carried.
- Only a real `PRESS` increments the key count; auto-repeat arrives as `HOLD`.
- **Move:** the box is translated by `direction × kNudgeStep` in **world space**, the same as the gizmo's translate, and the region preview is updated when carrying contents. A model goes through `renderer->NudgeSelectedModel(direction)`.

A burst (one key held down, or several pressed one after another) is **one undo step**.

### `FinishNudge()` *(private)*
For the box: clears the preview and reports `onCropBoxEdited` if it moved. For a model: reports `onTransformEdited` only if the model is still the selected one and moved. Both are timed with `ScopedCommit`.

## Overlay drawing

### `DrawToolButtons()` *(private)*
A top-right ImGui window with **Pan / Move / Rotate / Scale** buttons. The active one is highlighted blue, and the tooltips show the Q/W/E/R shortcuts. Unlike the stats overlay, it **accepts input**, so ImGui captures clicks on it and they never reach the camera.

### `DrawImGui(fps)` *(private)*
When enabled, a read-only stats window (`NoInputs`, so it never blocks camera drags) sits below the tool buttons. It shows: instant fps and ms; the 1-second average fps and worst frame; scene CPU and GPU ms; drops in the last second and in total (red if any); a **frame-time plot** of the last 256 intervals, scaled so one refresh sits at a third of the height and dropped frames clearly stick up; *Measuring: <activity>*; models out of 32; splat count; the selected model's centre; the tool; and the render mode.

### `DrawRecordingIndicator()` *(private)*
While a metrics recording runs: a top-left window with a red dot blinking once a second, *REC mm:ss*, average fps and drops, and *"Ctrl+Shift+R to stop"*.

### `DrawGridLabels(view, proj)` *(private)*
Draws on ImGui's **background** draw list, so it never covers the overlay windows.
- **Unit numbers** along ±X (red) and ±Z (blue), out to the grid's fade start, plus a `0` at the origin. Walking out from the origin, a label closer than **26 px** on screen to the last one drawn is skipped, so labels never pile up near the horizon.
- An **XYZ orientation marker** in the bottom-left corner: each world axis is rotated by the view matrix and drawn as a coloured line with a letter.
- For the selected, visible model: a yellow **drop line** from its centre down to the grid, a circle where it meets the grid, and its `(x, y, z)` coordinates.

The helper lambda `project(world, out)` converts to widget pixels and returns false when the point is behind the camera or off screen.

### `ModelCentre(model)` *(private)*
The model's centre in world space, using the **per-axis median** of its splat positions. This is the same point the local build centres models on, and it is robust to stray splats, unlike the centre of the bounding box. The local result is **cached** for one model. The cache is invalidated when the model pointer, data pointer, count, or first or last splat position changes, which catches a re-trim or reload. With no splats it returns the transform's translation.

### `ReportMetricsActivity()` *(private)*
Tells `FrameMetrics` what the user is doing this frame: a gizmo translate, rotate or scale (on the model, the box, or the box and its contents), a nudge, a camera orbit (right button held), a camera pan (left button held), or idle.

## Qt input handlers
Every event goes to ImGui first. The engine only sees an event that ImGui does not want, so dragging on an ImGui panel does not orbit the camera.
- **`mousePressEvent`:** sends the event to ImGui and stores the position. It stops if ImGui wants the mouse, or if the **left** button pressed on the gizmo (`IsOver` or `IsUsing`), since that click grabs an arrow and should not move the camera. Otherwise it sends `PRESS` to the InputManager and records which button is held.
- **`mouseReleaseEvent`:** sends to ImGui and clears the held flags.
- **`mouseMoveEvent`:** sends to ImGui, computes the delta, and sends `HOLD` with dx/dy for each held button.
- **`wheelEvent`:** sends to ImGui, then scroll by notches (`angleDelta.y / 120`) unless ImGui wants it.
- **`keyPressEvent`:** sends to ImGui, then `CallbackKeyPress(key, autoRepeat ? HOLD : PRESS)` unless ImGui wants the keyboard.
- **`keyReleaseEvent`:** sends to ImGui. Qt sends a release before every auto-repeat press, so only real releases are forwarded.
- **`focusInEvent` / `focusOutEvent`:** forward focus to ImGui. On focus loss it clears the held buttons and **closes any nudge burst**, because the key release will never arrive.
- **`focusNextPrevChild`:** returns false, so Tab goes to ImGui instead of Qt's focus chain.
