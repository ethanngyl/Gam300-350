# `splat/SplatExporter.h` / `SplatExporter.cpp`

Converts loaded splats into other 3D file formats so they can be used in other tools. Each splat is first **baked into scene space**: the model transform is applied and faint splats are dropped. It is then written either as a splat, as one point per splat, or as a mesh of small ellipsoids that follow each Gaussian's scale and rotation. The binary writers assume a little-endian host, which is checked with a `static_assert`. It is safe to call from a worker thread; [ui/ExportDialog](../ui/ExportDialog.md) runs it on one.

## Types

| Type | Values / fields |
|---|---|
| `ExportFormat` | `GaussianPly` (3DGS, re-importable, DC colour only), `SplatFile` (antimatter15 `.splat`, 32 B per splat, for web viewers), `PointCloudPly` (coloured PLY for MeshLab, CloudCompare, Blender), `Obj` (with vertex colours), `Glb` (binary glTF 2.0), `Stl` (binary, mesh only, no colour). |
| `ExportGeometry` | `Points` (one vertex per splat) or `Mesh` (one ellipsoid per splat). |
| `ExportOptions` | `format` (default Glb), `geometry` (default Points; ignored by formats that support only one), `highDetailMesh` (false = octahedron with 8 triangles, true = icosahedron with 20), `sigmaScale` (1.5 standard deviations), `minAlpha` (0 = keep all). |
| `ExportSource` | A pointer to one model's splats in model space, plus its transform. |
| `ExportResult` | `ok`, `error`, `splatCount`, `vertexCount`, `triangleCount`. |

## Public functions

### `ExportResult ExportSplats(const std::vector<ExportSource>&, const std::filesystem::path&, const ExportOptions&)`
Writes every source into **one** file. Transforms are baked in, so the export matches the viewport.
1. `BakeSources(sources, minAlpha)`. If nothing is left, it reports *"There are no splats to export…"*.
2. Opens a `Writer`.
3. Chooses the writer by format: `WriteGaussianPly` and `WriteSplatFile` work on splats directly. The geometry formats build a `Mesh` first; STL is forced to `Mesh` because it cannot hold points. Then it calls `WritePly`, `WriteObj`, `WriteStl` or `WriteGlb`.
4. `writer.finish()`. A failure is reported as *"is the disk full?"*.
5. `std::bad_alloc` becomes an out-of-memory message with advice (raise minimum opacity, use low detail, or export points). Any other exception's `what()` becomes the error.

### `ExportFormatExtension(f)` / `ExportFormatName(f)`
Return the extension (for example `.glb`) and the display name (for example `glTF Binary (.glb)`).

### `ExportFormatSupportsPoints(f)` / `ExportFormatSupportsMesh(f)`
Points are supported by PointCloudPly, Obj and Glb. Mesh is supported by those three plus Stl.

## Internal pieces

### Shapes
- **`MakeOctahedron()`**: 6 vertices and 8 triangles.
- **`MakeIcosahedron()`**: 12 vertices built from the golden ratio, normalised, with 20 triangles.

Both wind counter-clockwise seen from outside, so face normals point outward.

### `BakeSources(sources, minAlpha)`
For each source it splits the transform's linear part into a **uniform scale** (the average column length) and a rotation (`quat_cast(linear / scale)`). That is all the editor produces; a non-uniform scale has no exact per-splat equivalent. For each splat it skips faint ones (`alpha < minAlpha`) and ones with a non-finite position (a NaN would make the `.glb` bounds invalid JSON). It then transforms the position, multiplies `scale` and `pointSize` by the scale, and pre-multiplies the rotation quaternion.

### `BuildMesh(splats, options)`
- **Points:** one position and one RGBA byte colour per splat, with no indices.
- **Mesh:** for each splat, every unit-shape vertex `u` becomes `position + R · (u ⊙ scale · sigmaScale)`. All of a splat's vertices get its colour, and the indices are offset by the splat's base vertex.

### `ColorBytes(s)`
sRGB colour and alpha, each clamped to 0…1, converted to bytes 0…255.

### `ToQuat` / `FromQuat`
Convert between the stored (w,x,y,z) `vec4` and `glm::quat`.

### `class Writer`
A buffered `std::ofstream` that flushes every 1 MB. It provides `bytes`, `pod<T>`, `text`, and `number(float)`, `number(float, decimals)` and `number(uint64)` (all locale-independent, using `std::to_chars`). `finish()` flushes, closes and returns `!fail()`.

### Splat formats (original 3DGS coordinates)
**`UnflipPosition`** and **`UnflipRotation`** undo the loader's y flip. `F = diag(1,−1,1)` is its own inverse.
- **`WriteGaussianPly`**: header with `x y z f_dc_0..2 opacity scale_0..2 rot_0..3`, then 14 floats per splat. It applies the inverse of `splat_decode`: `f_dc = (color − 0.5)/C0`, `opacity = logit(alpha)` (alpha clamped to [1e-6, 1−1e-6]), and `scale = log(max(s, 1e-12))`.
- **`WriteSplatFile`**: the antimatter15 layout of position (3 floats), scale (3 floats), RGBA (4 bytes) and rotation w,x,y,z quantised as `q·128 + 128` (4 bytes). Splats are **sorted largest and most opaque first** (by `volume × alpha`), as web viewers expect.

### Geometry formats (engine coordinates, y up)
- **`WritePly`**: binary vertices with float xyz and uchar RGBA, plus an optional `face` element with `list uchar uint vertex_indices`.
- **`WriteObj`**: `v x y z r g b` lines (the vertex-colour extension Blender and MeshLab read), plus `f a b c` lines using 1-based indices.
- **`WriteStl`**: 80-byte header, triangle count, then for each triangle a normal (normalised cross product), three vertices and a 2-byte attribute.
- **`WriteGlb`**: glTF 2.0 binary.
  - `COLOR_0` must be **linear**, so the sRGB bytes are converted through a 256-entry `SrgbToLinear` lookup table into **normalised `uint16`**, which keeps dark shades from banding. Alpha is `a·257`.
  - The JSON declares one mesh primitive, `mode 0` (points) or `4` (triangles), and an **unlit** material (`KHR_materials_unlit`), so viewers show the captured colours without relighting them. It includes position min/max bounds and buffer views for positions, colours and indices, all 4-byte aligned. The JSON is padded with spaces to a multiple of 4.
  - It refuses files larger than 4 GB (the glTF size field is `uint32`) with advice.
  - It writes the `glTF` header, the `JSON` chunk and the `BIN` chunk.
- **`SrgbToLinear(c)`**: the standard sRGB transfer function.
