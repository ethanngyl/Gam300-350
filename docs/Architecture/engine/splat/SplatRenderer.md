# `splat/SplatRenderer.h` / `SplatRenderer.cpp`

*Primary author: Clement.* Owns every `SplatModel` in the scene and draws them. All visible models are packed into **one combined vertex buffer**, and each model's transform is a shader uniform, so moving a model costs nothing on the CPU. There are two render modes:

- **PointCloud:** flat, alpha-blended circular point sprites with no sorting and no covariance.
- **GaussianSplat:** each splat is projected to an oriented 2D Gaussian ellipse, and the splats are blended back to front. It supports 3DGS-style `.ply` files.

`kMaxModels = 32`, which must match the shader's `uModelTransforms[32]`.

## Shaders (anonymous namespace)

### Point cloud (`kVertexShaderSrc` / `kFragmentShaderSrc`)
- Vertex: `world = uModelTransforms[int(aModelId)] · pos`. **Selected** splats are marked with `fract(aModelId) > 0.25` (see `RebuildCombinedBuffer`) and tinted 40% toward green. If a selected splat belongs to `uRegionModel` (a crop-box drag preview), its world position is multiplied by `uRegionDelta` and its size by the length of the first column of `uRegionLinear`. Point size is `max(pointSize · uPixelsPerUnit / w, 1)`.
- Fragment: a round sprite with alpha falloff `1 − r²`; anything outside the circle is discarded.

### Gaussian, desktop (vertex → geometry → fragment)
1. **Vertex** (`kGaussianVertexShaderSrc`):
   - Transforms the centre into view space (with the region preview applied) and culls splats behind the camera (`t.z > −0.01`).
   - Builds **`A = W · regionLinear · M · R(q) · S`**, where S holds the per-axis widths, R is the rotation and W is the view rotation. The 3D covariance in view space is then `Σ = A·Aᵀ`. That matrix is never built directly: `A` is cheaper, and `A·Aᵀ` can never become an invalid (negative-size) ellipsoid through rounding.
   - Computes the **Jacobian J** of the perspective projection from the focal lengths `fx = P[0][0]·W/2` and `fy = P[1][1]·H/2`. The splat centre is clamped to 1.3× the frustum edge so J does not explode for off-screen splats.
   - Screen covariance is `Σ' = (J·A)(J·A)ᵀ`, plus **0.3 px on the diagonal** as a low-pass filter so sub-pixel splats stay visible.
   - **Eigen-decomposes** the 2×2 matrix into a major and minor axis (1σ lengths are `√λ`), converted to NDC with `2/viewport`.
2. **Geometry** (`kGaussianGeometryShaderSrc`): expands each point into a **±3σ quad** along the two axes, multiplied by `w` because positions are in clip space. It skips culled splats and splats whose centre is more than 1.3× outside the screen.
3. **Fragment** (`kGaussianFragmentShaderSrc`): `d² = |offset|²` in σ units. It discards beyond 3σ; otherwise `alpha = opacity · exp(−d²/2)`, and it discards below 1/255.

### Gaussian, WebGL2 (`kGaussianGlesVertexShaderSrc`, only with `CODEFINE_GLES`)
GLES3 has no geometry stage, so each splat is an **instanced quad**. Instance attribute 1 is the sorted splat index. The splat data is read with `texelFetch` from an **RGBA32F texture holding 4 texels per `SplatVertex`**, in struct order: (position, pointSize), (color, alpha), (modelID, scale), (rotation). The maths matches the desktop shaders, which must be kept in sync. Culled corners are placed outside the clip volume (`z = 2`). `static_assert`s fix the struct layout at 16 floats with the expected offsets. The texture is `kSplatTextureWidth = 4096` texels wide, a multiple of 4, so one splat never wraps across rows.

## Lifecycle

### `SplatRenderer()`
Compiles the point-cloud shader and the Gaussian shader (the desktop three-stage version or the GLES version). It creates the VAO, VBO and EBO and sets attributes 0–6 from the `SplatVertex` offsets (position, pointSize, color, alpha, modelID, scale, rotation); the point-cloud shader ignores 5 and 6. On GLES it also builds the quad VAO (corners plus a per-instance index with divisor 1) and the splat texture with `GL_NEAREST` filtering, because float textures are not filterable in WebGL2.

### `~SplatRenderer()`
On desktop it first **waits for any background sort**, using `wait()` rather than `get()` so a sort that threw is not rethrown from a destructor. It then clears the models. On GLES it also deletes every GL object, because the web build can tear one viewer down and create another in the same context.

## Model management

| Function | Behaviour |
|---|---|
| `SetSplats(splats, name)` | Adds a new `SplatModel` with these splats and name, increments `m_totalCreatedCount`, and marks the buffer for rebuild. |
| `RemoveModel(index)` | Erases the model. The model selection follows the same model, or is cleared if that model was removed. Marks for rebuild (model ids are now out of date). Out-of-range indices are ignored. |
| `GetModel(index)` | Returns a pointer, or `nullptr` if out of range. |
| `UpdateModel(model, splats)` | Replaces a model's splats and marks for rebuild. |
| `SetModelHidden(index, hidden)` | Changes visibility. Hidden models are left out of the combined buffer, so this marks for rebuild. |
| `TranslateModel`, `ScaleModel`, `RotateModel` | Forward to `SplatModel`. No rebuild is needed because transforms live on the GPU. |
| `GetModelName(i)`, `ModelCount()`, `TotalCreatedCount()`, `TotalSplatCount()`, `GetSplatCount(i)` | Accessors. `TotalSplatCount` adds up the count of every model. |
| `GetSelectedModel()` / `SelectModel(i)` | The selected model index. Out of range sets −1. |
| `NudgeSelectedModel(direction)` | Translates the selected model by `direction × kNudgeStep (0.1)`. |

## Splat selection and region preview

### `SetSelection(modelIndex, indices)`
Stores the confirmed selection: **ascending** indices into one model's splat list. An invalid model or an empty list clears the selection. Marks for rebuild, because selected splats are marked in the buffer. Any change to the splat list (removing, trimming) makes the indices out of date, so callers clear the selection then.

### `ClearSelection()`
Clears the selection **and** the region preview, and marks for rebuild.

### `HasSelection()`, `SelectionModel()`, `Selection()`
Accessors.

### `SetRegionPreview(deltaWorld)` / `ClearRegionPreview()`
A live preview of a crop-box drag. The selected splats are **drawn** moved by `deltaWorld` (`newBox · inverse(startBox)`) **without touching the splat data**. `DecomposeRegionDelta` ([CropBox](CropBox.md)) splits the delta, and `m_regionLinear = rotation × average scale` is applied to the splat shape in the shader. Clearing sets `m_regionModel = −1`.

### `SetRegionUniforms(shader)` *(private)*
Uploads `uRegionModel`, `uRegionDelta` and `uRegionLinear`.

## Drawing

### `Draw(view, proj, widthPx, heightPx, camPos)`
Rebuilds the combined buffer if it is marked modified. Returns if there are no models. It **turns off depth testing**, because both modes draw translucent splats, then dispatches to `DrawGaussian` or `DrawPointCloud(proj·view, …)`, and turns depth testing back on. View and projection are passed separately because Gaussian mode needs the view-space position and the projection's focal lengths.

### `DrawPointCloud(viewProj, heightPx, camPos)` *(private)*
Sets the uniforms (`uPixelsPerUnit = height/2`, region uniforms and every model transform) and calls `glDrawArrays(GL_POINTS, …)`. An older path that sorted with `std::sort` under a time budget (4 ms, turned off after 3 frames over budget, retried after 120) is still in the code but turned off with `&& false`. Only its frame counters still run.

### `DrawGaussian(view, proj, widthPx, heightPx)` *(private)*
Turns on standard alpha blending and sets the view, projection, viewport, region and model-transform uniforms. It calls `SortSplatsBackToFront(view)`, then draws `GL_POINTS` through the sorted EBO on desktop, or `glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, N)` with the splat texture bound on GLES.

## Depth sorting

### `SortSplatsBackToFront(view)` *(private)*
1. **Desktop:** if a background sort is running and not finished, it keeps drawing the old order and returns. If it has finished, it collects the result with `get()` and calls `ApplyPendingSort()`.
2. Collects the current model transforms. Camera position and forward come from `inverse(view)`.
3. **Sort cache:** if the order is not marked dirty and the transforms have not changed, it skips the sort unless the camera **turned more than about 1°** (`dot < 0.9998`) or **moved more than 1% of the last depth range**.
4. Takes a snapshot of the view, transforms, position and forward into the `m_pending*` fields, so the sort never reads state the main thread is changing.
5. **Desktop:** if the order is not dirty, it starts `std::async(BuildSortOrder)` and returns. The **first sort after the splat set changes runs right away**, because the draw would otherwise use an index buffer for the old splat set. **GLES:** it always sorts on the spot.

### `BuildSortOrder()` *(private, CPU only, safe on a worker thread)*
- For each model it precomputes row 2 of `view · model`, so each splat's view-space depth is one `dot(row, (pos, 1))`.
- **O(n) counting sort with 65,536 buckets**, instead of `std::sort`'s O(n log n):
  1. *Count:* map each depth into a 16-bit bucket over `[min, max]` and count each bucket (shifted by one).
  2. *Prefix:* running sum, so each bucket knows its first slot.
  3. *Scatter:* place each splat index in the next free slot of its bucket.

  More negative z means farther away, so the order comes out far to near. It saves the depth range in `m_pendingRange` for the movement threshold.

### `ApplyPendingSort()` *(private, main thread, makes GL calls)*
Swaps `m_pendingOrder` into `m_sortOrder` and uploads it with `glBufferSubData`, to the EBO on desktop or the instance-index VBO on GLES. It records the snapshot as the last sort and clears the dirty flag.

## Buffers

### `RebuildCombinedBuffer()` *(private)*
- **Desktop:** waits for any background sort and discards its result, because the splat set is changing.
- Concatenates the splats of every **visible** model into `m_combined`, setting `modelID` to the model's slot. Hidden models are skipped but keep their slot index in the transform array. **Selected splats get `modelID + 0.5`**, found by walking the ascending selection alongside the splat index. Every reader truncates the id to get the model back.
- Uploads the VBO, reserves the EBO (`GL_DYNAMIC_DRAW`) and, on GLES, the order VBO and the splat texture.
- Clears the modified flag and marks the sort dirty.

### `UploadSplatTexture()` *(private, GLES only)*
Allocates a `4096 × rows` RGBA32F texture (1024 splats per row). If the row count would exceed `GL_MAX_TEXTURE_SIZE`, it warns and draws only the splats that fit. It uploads the full rows in one call and the partial last row in a second.
