# Web app: model file handling (`.ply` / `.obj`)

*Author: Xiong Yang.* These modules read and convert model files in the browser. The heavy work runs in **Web Workers**, so a large model never freezes the page.

---

## `plyHeader.js`
Reads metadata from a Brush `.ply` **without downloading the whole file**. It fetches only the first **4 KB** using an HTTP `Range: bytes=0-4095` request, which the backend supports (including from the database and through the VM proxy).

| Function | Behaviour |
|---|---|
| `readHeaderText(res)` *(private)* | Reads from the body stream until 4 KB have arrived, then **cancels the reader** and decodes the text. |
| `parseCameraUp(text)` *(private)* | Matches Brush's `Vertical axis: x y z` header comment. |
| `describeHttpProblem(res)` *(private)* | A user-facing sentence for 401 (signed out), 403, 404 (*"missing / not finished"* when the server says *not ready*, otherwise *"deleted or belongs to another account"*), 429, 502/504 and other 5xx codes. |
| `describeFormatProblem(text)` *(private)* | Not `ply`; not `binary_little_endian` (an ASCII file is named as such); `end_header` beyond 4 KB (gives `null`, so the loader decides); `element chunk` (compressed layout, accepted); a vertex count of 0 (*"empty"*). It requires `scale_0`, `rot_0` and `opacity`, plus `f_dc_0` or `red`; otherwise *"a plain point cloud, not a gaussian splat model."* |
| **`checkSplatPly(url)`** | Used by the Scene Builder **before** it downloads a whole model. Returns `{ up, problem }`, where `problem` is `null` when the file looks loadable. Network errors and interrupted downloads get their own messages. |
| **`readCameraUp(url)`** | `[x, y, z]`, defaulting to `[0, 1, 0]`, so any scene renders upright. |
| **`readPlyInfo(url)`** | `{ splatCount }` (from `element vertex`) and `{ fileSizeBytes }` (from `Content-Range: bytes 0-4095/<size>`), for the model page. |

---

## `plyToObj.js` + `plyToObj.worker.js`
Converts a Gaussian splat `.ply` into a **Wavefront `.obj` in the browser**. It is a port of the engine's OBJ export (`SplatExporter.cpp` `WriteObj`), so the web app and the desktop editor write the same file. See [engine/splat/SplatExporter](../../engine/splat/SplatExporter.md).

### `plyToObj.js`
- **`OBJ_EXPORT_DEFAULTS`**: `{ geometry: 'mesh', highDetail: false, sigmaScale: 1.5, minAlpha: 0.1 }`, the engine Export dialog's defaults.
- `SH_C0`, plus the `OCTAHEDRON` (6 vertices, 8 triangles) and `ICOSAHEDRON` (12 vertices, 20 triangles, golden ratio, normalised) unit shapes.
- **`objExportEstimate(splatCount, options)`**: `{ vertices, triangles }` for the dialog's *"Up to N…"* line.
- `PLY_TYPES`: byte size and `DataView` getter for every PLY scalar type.
- **`parsePlyHeader(bytes)`**: looks at up to 1 MB of latin1 text and requires `ply` and `end_header`. Returns `{ format, elements: [{ name, count, properties: [{ name, isList, type, countType }] }], headerLength }`.
- `formatFloat(v)` (7 significant digits), `COLOR_TEXT` (`"0.000"`…`"1.000"` for each byte, precomputed), `colorByte(v)`.
- **`convertPlyToObj(buffer, options, onProgress)`**:
  1. Rejects ASCII and unknown formats, and supports binary little- and big-endian. It skips any fixed-size elements before `vertex` (list-valued elements before it are not supported). It builds a property layout (offset and getter) and requires the 14 splat fields (`REQUIRED`), checking the file is not truncated.
  2. **Pass 1, vertices:** for each splat, alpha is the sigmoid of `opacity`, and splats below `minAlpha` are skipped. Positions get **the same y-flip as the engine loader** (`y → −y`), so the `.obj` is y-up as in the viewport. Non-finite positions are skipped. Colour is `0.5 + C0·f_dc`. *Points:* one `v x y z r g b` line. *Mesh:* the quaternion is flipped the same way (`(w, −x, y, −z)`) and normalised, giving a rotation matrix; the radii are `exp(scale)·sigma`; every unit-shape vertex is rotated and offset.
  3. With no splats kept, it throws *"no splats to export"*.
  4. **Pass 2 (mesh only):** an `f a b c` line for each triangle of each kept splat, using 1-based indices.
  5. Text builds up in strings of about **1 MB** (`parts`), ready for `new Blob(parts)`. Progress is weighted 75/25 between the two passes for meshes. Returns `{ parts, splatCount, vertexCount, triangleCount }`.

### `plyToObj.worker.js`
In: `{ url, sizeHint, options }`. It calls `fetchWithProgress` and posts `{ type: 'progress', stage: 'download', fraction }`, then converts, posting `stage: 'convert'` at most every 1%. Finally it posts `{ type: 'done', blob (model/obj), splatCount, vertexCount, triangleCount }`. A `RangeError` (out of memory) becomes advice: raise the minimum opacity, use low detail, or export points.

---

## `objParser.js` + `objParser.worker.js`
A **streaming** Wavefront `.obj` parser for the `.obj` viewer. It works on text chunks, so a large file never has to fit in one string. three.js's `OBJLoader` needs the whole file as one string, which fails for large scan exports.

### `objParser.js`
- `class Buffer`: a typed-array builder that **doubles its capacity** as it grows (starting at 65,536 entries). `result()` returns a trimmed copy.
- `srgbToLinear(c)`: vertex colours are sRGB in the file but must be **linear** for three.js.
- **`createObjParser()`** returns `{ push(text), finish() }`.
  - `push` splits the text on `\n` and keeps a partial last line for the next chunk.
  - `v x y z [r g b]` lines add a position, plus a colour if there are at least 7 fields (white otherwise).
  - `f` lines accept `v`, `v/vt`, `v//vn` and `v/vt/vn`, including **negative (relative) indices**. A face with any bad index is skipped. Faces are **triangulated as fans**.
  - Normals, texture coordinates, materials and groups are ignored. A file **without faces** is shown as a point cloud.
  - `finish()` returns `{ positions, colors | null, indices | null, vertexCount, triangleCount }`.

### `objParser.worker.js`
In: `{ url, sizeHint }`. It uses `streamWithProgress` with a streaming `TextDecoder` to feed the parser **while the file downloads**, posting progress at most every 1%. It requires at least one vertex, then posts `done` with the typed arrays **transferred** (no copy). A `RangeError` becomes *"too large to view in the browser"*.
