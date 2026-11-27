# `ui/ExportDialog.h` / `ExportDialog.cpp`

The **File → Export** options dialog. It asks what to export (the selected model or the whole scene), the target format, and, for mesh formats, how each splat becomes geometry. It shows a size estimate and saves the last choices in `QSettings`. The export itself is done by [splat/SplatExporter](../splat/SplatExporter.md).

## Controls
| Row | Widget | Notes |
|---|---|---|
| Export | combo | *Selected model (<name>)* appears only when a model is selected, followed by *Whole scene (all models merged)*. |
| Format | combo | In order: GLB, OBJ, PLY, STL, Gaussian PLY, Splat. The label shows the name and extension, and the item data is the `ExportFormat`. |
| (description) | label | `FormatDescription(format)`: which tools open it, and its limits (for example, Gaussian PLY drops `f_rest`). |
| Geometry | combo | Points or Mesh. |
| Mesh detail | combo | Low (8 triangles) or High (20 triangles). |
| Splat size | spin 0.25–4 σ | Ellipsoid radius. |
| Min opacity | spin 0–0.99 | Skips faint "haze" splats, which make mesh exports much larger. |

The OK button reads **"Export..."**.

Saved settings: `export/format` (default GLB), `export/geometry` (default Mesh), `export/highDetail` (false), `export/sigma` (1.5), `export/minAlpha` (0.1).

## Functions

### `ExportDialog(selectedName, selectedSplats, sceneSplats, parent)`
Builds the form, loads the saved values (falling back to index 0 if a saved value is no longer in a combo), connects every combo and the min-opacity spin box to `updateControls()`, and calls it once. `selectedSplats = 0` means nothing is selected, so only the whole scene can be exported.

### `ExportOptions options() const`
Reads the controls into `ExportOptions`. It **forces the geometry to whatever the format can hold**: Points if the format has no mesh support, Mesh if it has no point support (STL).

### `bool wholeScene() const`
True when nothing is selected or the second source item is chosen.

### `void accept()`
Saves the current choices to QSettings, then calls `QDialog::accept()`.

### `void updateControls()` *(private)*
- Updates the description.
- Enables *Geometry* only when the format supports both points and mesh, and *Mesh detail* and *Splat size* only when the export is a mesh.
- **Estimate:** for a mesh, *"Up to N·6 (or ·12) vertices and N·8 (or ·20) triangles"*; otherwise *"Up to N points/splats"*. It adds *"(fewer after the opacity filter)"* when min opacity is above 0. The estimate is an upper bound, because the opacity filter removes an unknown share.

## Helpers
`FormatDescription(format)`, `TrianglesPerSplat(high)` (8 or 20) and `VerticesPerSplat(high)` (6 or 12).
