# `Manager/StressTestRunner.h` / `StressTestRunner.cpp`

Runs the editor's **automated stress tests** on the scene of one `Viewport` and times each step. It has no UI. [ui/StressTestPanel](../ui/StressTestPanel.md) calls it and shows the returned rows, which can also be exported to the metrics log ([metrics/FrameMetrics](../metrics/FrameMetrics.md)).

Every test follows the same rules:
- **Clean start.** It clears the selection and calls `Viewport::RenderFrameBlocking()` before timing, so earlier pending GPU work does not count against the first case.
- **Two-part timing.** It times the *Apply* (the CPU change in memory) and the *Redraw* (the next blocking frame) separately. The renderer defers GPU uploads to the next draw, so the real upload cost appears in the Redraw row.
- **Leaves no trace.** Edits go on a **private `QUndoStack`** and are undone afterwards, so the editor's undo history and the model end up exactly as they started.
- **Returns an empty vector** if there is no renderer, no selected model, or the model has 0 splats.

## `struct StressResult`

| Field | Meaning |
|---|---|
| `name` | Row label, for example `"Move half of splats: Apply"`. |
| `splatCount` | Number of splats the step worked on. |
| `ms` | Time the step took, in milliseconds. |
| `tooltip` | Plain-language explanation shown when hovering the row. |
| `ok` / `note` | `false` plus a reason when the step could not run (for example, the disk is full). A failed step still gets a row, so logs never have gaps. |

## Internal helpers

- **`MeasureMs(fn)`**: runs `fn` with a `QElapsedTimer` running and returns `nsecsElapsed / 1e6`.
- **`MakeIndices(total, stride)`**: returns ascending indices `0, stride, 2·stride, …` below `total`. `SetSelection` expects ascending order.
- `kApplyTip`, `kRedrawTip`, `kUndoTip`, `kRedoTip`: shared tooltip wording.

## Public members

### `StressTestRunner(Viewport*)`
Saves the viewport whose renderer and scene the tests use.

### `std::function<void(const QString&)> onStep`
Progress callback, called with the name of the step about to run. It is called **outside** the timed sections, so it does not affect the results. The private `Report(step)` calls it if it is set.

### `TestLoad(size_t count)`
Generates a sphere of `count` splats with `splat_generate::GenerateSphereSplats` and passes it to `LoadThroughDisk(..., "StressTestSphere")`. The sphere model stays in the scene.

### `TestLoadCopy()`
Runs the same load test on a copy of the **selected** model's splats (named `"<model> (load test copy)"`). It never reads the model's own file. Afterwards it removes the copy, which is always the last model, so no index shifts and the selection does not change.

### `LoadThroughDisk(std::vector<SplatVertex> source, const std::string& name)` *(private)*
1. Refuses if the scene already has `SplatRenderer::kMaxModels` models or `source` is empty.
2. **Setup (not timed):** writes `source` as a Gaussian PLY with `ExportSplats` into a `QTemporaryDir`, then frees `source` (swap with an empty vector) so the splats are not held in memory twice.
3. **Timed:** `LoadSplatPly(path)` (the same call an import makes), then `renderer->SetSplats(splats, name)`, then one blocking frame.
4. Returns three rows: *Read from disk*, *Add to scene* and *Redraw*. The tooltip warns that the OS file cache probably makes the read faster than a cold read.

### `TestSelect()`
For each case **All / Half / Tenth** (stride 1, 2, 10), it times building the index list plus `SetSelection` (Apply), then one frame (Redraw), then clears the selection. It finishes by setting a full selection (not timed) and timing `ClearSelection` plus a frame together as *Deselect all: Apply + Redraw*.

### `TestTrim()`
Trims the selected model with several `TrimData` settings, using the same `TrimSplats` code as the Inspector.
- It keeps a copy of the original splats in `saved`, and every case starts from it.
- **Flat-alpha handling.** If every splat has the same alpha (the test sphere does), min-alpha would cut nothing. In that case the min-alpha cases trim a copy whose alpha values are spread over 0…1 in golden-ratio steps (`fmod(i·0.618…, 1)`).
- **Adaptive thresholds.** `alphaForCut(f)` uses `std::nth_element` to find the alpha at the 25th, 50th and 90th percentile, so every model loses about the same share.
- Density minimum: `max(2, total/10000)` splats per voxel, with 50 voxel divisions.
- Cases: crop 5%, crop 25%, density filter, crop 25% plus density, min alpha at the lowest 25%, 50% and 90%, and the default settings.
- Each case produces up to three rows: **Compute** (`TrimSplats`, with the kept percentage in the tooltip), **Apply** (`renderer->UpdateModel`) and **Redraw**. If a trim would remove every splat, the Apply and Redraw rows are skipped, matching the editor, which refuses such a trim. After each case the model goes back to `saved`. The model's stored trim values are never touched.

### `TestExport()`
Exports **every** splat of the selected model, with its transform baked in, in each format: Gaussian PLY, Splat file, PLY points, OBJ points, GLB points, GLB mesh and STL mesh. Each file goes into a temporary folder. The row records the time and file size, and the file is deleted straight away. Mesh tooltips add the vertex and triangle counts, since each splat becomes 6 vertices and 8 triangles. A failed export still gets a row with `ok = false` and the error text.

### `TestMove()`
- **Move model:** pushes a `MoveModelCommand` that translates the model by (0.5, 0, 0). Only the transform changes, so this is cheap. It is timed, then undone.
- **Move splats:** for *all splats* (stride 1), *half of splats* (stride 2) and *selected tenth* (stride 10, selected first, outside the timing), it pushes a `MoveSplatsCommand(renderer, model, indices, delta)`. That rewrites splat data, so the whole array is uploaded again. Each case is timed, undone, and the selection cleared.

### `TestDelete()`
- For *half of splats* and *selected tenth*, it builds a keep mask (1 = keep, 0 = delete) as setup, then times pushing a `RemoveSplatsCommand` and the next frame. Each case is undone afterwards.
- **Delete model:** deleting a model cannot be undone, so if there is room it adds a temporary copy (`"StressTestCopy"`), uploads it, and then times `RemoveModel(copyIndex)` and the next frame.

### `TestUndoRedo()`
For three edits (*move model*, *move all splats* and *delete half of splats*), each built by a lambda that returns a new `QUndoCommand`:
1. Setup: push the edit and render a frame.
2. Time **undo**, then a frame, then **redo**, then a frame. That gives four rows.
3. Undo again, clear the stack and clear the selection, so the model is back to how it started.
