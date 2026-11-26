# `splat/SplatLoader.h` / `SplatLoader.cpp`

Loads a Gaussian-splat `.ply` with the **happly** library and decodes it into `SplatVertex`es ([SplatData](SplatData.md)). On any failure it returns an **empty vector** and logs to `stderr`. Callers treat "no splats" as a valid, non-fatal state; for example, a missing sample asset should not crash the engine.

## Public functions

### `std::vector<SplatVertex> LoadSplatPly(const std::string& path)`
Parses the file with `happly::PLYData(path)` and calls `DecodeSplats`. It catches every `std::exception` and logs `[SplatLoader] failed to load '<path>': <what>`.

### `std::vector<SplatVertex> LoadSplatPlyFromMemory(const unsigned char* data, size_t size, const std::string& label)`
Does the same for a `.ply` already in memory. The web build uses it, because there the file arrives as fetched bytes. It wraps the bytes in a `MemoryStreamBuf` and `std::istream` so happly parses them **without copying**. `label` is only used in error messages.

## Internal helpers

### `struct MemoryStreamBuf : std::streambuf`
A read-only stream buffer over an existing byte range. It calls `setg(begin, begin, end)`.

### `std::vector<SplatVertex> DecodeSplats(happly::PLYData& ply)`
Reads these float properties from the `vertex` element: `x y z`, `scale_0..2`, `rot_0..3`, `opacity` and `f_dc_0..2`. A missing property throws. For each vertex:
- `pointSize = exp(mean of the three log scales)`; `scale = exp(scale_i)` per axis.
- **Y flip ("upside down fix").** The position becomes `(x, −y, z)`. That is the reflection `F = diag(1, −1, 1)`, and the covariance must be reflected the same way: `F R S Sᵀ Rᵀ F`. Since `F R F` is a rotation, and conjugating a quaternion by this reflection maps `(w,x,y,z)` to `(w,−x,y,−z)`, the stored rotation becomes `(q.x, −q.y, q.z, −q.w)` of the decoded `(w,x,y,z)` vec4. `F S S F = S S` because S is diagonal, so the scale is unchanged.
- `color = decodeColor(f_dc)`, `alpha = sigmoid(opacity)`.
