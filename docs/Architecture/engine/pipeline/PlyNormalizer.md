# `pipeline/PlyNormalizer.h` / `PlyNormalizer.cpp`

A C++ port of `tools/normalize_ply.py`, so local builds need no Python. COLMAP and Brush reconstruct in an arbitrary frame, with the object far from the origin and at an arbitrary scale. This **recentres** the splat on its median point and **rescales** it so 90% of splats lie within `targetRadius`. It uses the same maths and defaults as the script, so a model built on this PC is framed the same way as one built by the backend.

## `QString NormalizeSplatPly(const QString& input, const QString& output, double targetRadius = 1.5, QString* summary = nullptr)`

Returns an **empty string on success**, otherwise an error message. It is safe to call from a worker thread.

1. **Header parsing.** The first line must be `ply` and the second `format binary_little_endian 1.0`. Each line up to `end_header` is kept **byte for byte** (only the `\n` is removed; a `\r` stays), so Brush's `Vertical axis` comment survives. It reads the count from `element vertex N` and the name of each `property float <name>`. Any property that is not a float is an error. It requires `x`, `y` and `z`.
2. **Size check before allocating.** It checks `count ≤ remaining bytes / row size`, so a corrupt header cannot request a huge buffer or overflow `rows × columns`. It then reads all vertex floats in one block. A short read means the file is truncated. Zero rows is an error.
3. **Robust centre.** `(cx, cy, cz)` is the per-axis **median**.
4. **Robust radius.** The **90th percentile** of distances from the centre. If that is 0 it falls back to the maximum distance, and if that is also 0, to 1.
5. **Transform.** With `factor = targetRadius / radius`, each position becomes `(p − c) · factor`. Gaussian scales are stored as logs, so `scale_0..2 += ln(factor)` (scaling becomes a shift) and the Gaussians keep their shape.
6. **Atomic write.** Writes the header lines followed by the modified data through a `QSaveFile`, so a failed write never leaves half a model.
7. If `summary` is given, fills it with `"Normalized N splats: center=(x,y,z) radius=r scale xf"`.

## Internal helpers
- **`Median(values)`**: uses `nth_element`. For an even count it is the mean of the two middle values, as in the Python script.
- **`Percentile(values, p)`**: nearest rank at index `round(p/100 · (n−1))`, as in the script.
