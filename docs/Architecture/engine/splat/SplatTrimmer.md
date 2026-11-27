# `splat/SplatTrimmer.h` / `SplatTrimmer.cpp`

Removes unwanted splats from a reconstruction: invalid values, nearly invisible splats, outliers at the edges of the scene, and isolated "floaters". The Inspector's trim controls, the Trim dialog, auto-trim on import and the stress test all use it.

## Settings types

### `struct TrimData`: user-facing, independent of scale
The default values are the factory defaults. `MainWindow` holds one as the global default for new imports, and each `SplatModel` holds the one it was last trimmed with.

| Field | Default | Meaning |
|---|---|---|
| `minAlpha` | 0.005 | Drop splats with alpha below this (0 = off). |
| `cropPct` | 0.05 | Percentage trimmed from **each end** of every axis (0 = off). |
| `voxelDivisions` | 100 | Density cells across the scene's diagonal (0 = off). |
| `minPerVoxel` | 3 | Drop splats whose cell holds fewer splats than this. |

### `struct SplatTrimmerParam`: in world units, for one specific set of splats
`minAlpha`, `maxSize` (0 = off), `cropLowPct`/`cropHighPct` (0 and 100 = off), `voxelSize` (0 = off) and `minPerVoxel` (default 5).

## Functions

### `SplatTrimmerParam ToTrimmerParam(const TrimData&, const std::vector<SplatVertex>&)`
Copies `minAlpha` and `minPerVoxel`, and sets `cropLow = cropPct` and `cropHigh = 100 − cropPct`. When `voxelDivisions > 0`, it measures the extent of the **cropped** scene (each axis between the crop percentiles), takes the length of its diagonal, and sets `voxelSize = diagonal / voxelDivisions`. The density filter therefore behaves the same at any scale.

### `std::vector<uint8_t> ComputeKeepMask(splats, params)`
Returns one byte per splat (1 = keep). The filters run in order:
1. **Per splat:** drop non-finite position, size or alpha; alpha below `minAlpha`; `pointSize` above `maxSize`.
2. **Crop:** for each axis, it finds the `cropLowPct` and `cropHighPct` percentiles among the splats **still kept** (`AxisPercentile`) and drops any splat outside that range on any axis.
3. **Density filter:** if `voxelSize > 0` and `minPerVoxel > 1`, it hashes every kept splat into a voxel `floor(p / voxelSize)`, counts splats per voxel in an `unordered_map`, and drops splats in voxels with fewer than `minPerVoxel`. These are the floaters.

### `std::vector<SplatVertex> ApplyKeepMask(splats, keep)`
Copies only the splats whose mask entry is 1. If the mask is the wrong size, it returns the input unchanged.

### `std::vector<SplatVertex> TrimSplats(splats, const TrimData&)`
Shortcut for `ApplyKeepMask(splats, ComputeKeepMask(splats, ToTrimmerParam(settings, splats)))`.

## Internal helpers
- **`VoxelKey` / `VoxelKeyHash`**: 64-bit integer cell coordinates, hashed with the usual spatial-hash primes (73856093, 19349663, 83492791) combined by XOR.
- **`IsFinite(s)`**: checks that position, `pointSize` and `alpha` are finite.
- **`AxisPercentile(splats, keep, axis, pct)`**: collects that axis's coordinate from kept splats and uses `nth_element` at `round(pct/100 · (n−1))`. It returns 0 if nothing is kept.
