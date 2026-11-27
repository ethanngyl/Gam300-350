# `pipeline/SplatAutoCrop.h` / `SplatAutoCrop.cpp`

*Author: Xiong Yang.* A C++ port of `tools/auto_crop.py`, so local builds need no Python. It keeps **only the object a walk-around capture was taken around**, working this out from COLMAP's camera poses:

- **Centre:** the point the photos look at.
- **Footprint** (seen from above): the path the cameras trace, closed by mirroring it through the centre.
- **Height:** cut where COLMAP's sparse points thin out above the object (before a ceiling) and below it (the floor).

Splats outside this region are removed. Captures that do not surround one object are left alone. It uses the same maths and thresholds as the script, so a local build is cropped the same way as a backend build.

## `struct AutoCropReport`
| Field | Meaning |
|---|---|
| `cropped` | False when the capture does not suit a crop. See `reason`. |
| `reason` | Why nothing was cropped. |
| `kept` / `total` | Splats kept / splats in the input, when cropped. |
| `camerasAimed` | Photos whose view passes near the centre (inliers). |
| `cameras` | Photos that have a camera position. |
| `arcDegrees` | How far round the object the cameras go. |

## `QString AutoCropSplatPly(sparseDir, input, output, AutoCropReport& report, double heightFactor = 1.0, double minKeep = 0.05)`
Returns an **empty string** on success, whether it cropped or skipped, and an error message on real I/O failure. `output` is written only when `report.cropped` is true. It is safe to call from a worker thread.

Steps:
`PickModelDir`, then `ReadCameras` (at least 8 cameras), then `FindCentre`, then `BuildRegion` (using `ReadPoints`), then `CropPly`.

Any "this capture doesn't suit cropping" condition throws `SkipCrop{reason}`. That exception is caught here and turned into `cropped = false` plus the reason.

## Thresholds (same as `auto_crop.py`)
| Constant | Value | Meaning |
|---|---|---|
| `kMinCameras` | 8 | Minimum posed photos (and inliers). |
| `kMaxMeanDirection` | 0.95 | If the average view direction is longer than this, every photo faces the same way. |
| `kMinInlierShare` | 0.6 | At least 60% of photos must aim at the centre. |
| `kMaxMedianMiss` | 0.3 | Median ray miss divided by median distance must not exceed this. |
| `kMinArcDegrees` | 90 | The cameras must span at least 90° around the object. |
| `kFootprintBins` | 720 | Footprint radius sampled every 0.5°. |
| `kHeightLayer` | 0.05 | Height layer thickness, as a fraction of the horizontal camera distance. |
| `kEmptyLayerShare` | 0.05 | A layer is "nearly empty" below 5% of the peak layer count. |

## Internal pieces

### `BinaryReader`
A bounds-checked little-endian reader over a `QByteArray`. It provides `get<T>()`, `getVec3()`, `skip(n)`, `skipString()` (to the NUL) and `ok()`. `getVec3()` reads x, y and z as separate statements, because three `get()` calls written as constructor arguments are evaluated in an unspecified order (MSVC goes right to left).

### `ReadCameras(images.bin)`
For each image it reads the id, the quaternion `(qw, qx, qy, qz)`, the translation `t` and the camera id, skips the name, and skips the 2D points (24 bytes each). It builds the world-to-camera rotation rows `r0, r1, r2` from the quaternion. The **camera centre** is `−Rᵀt`, the **view** direction is `r2` (COLMAP cameras look along +z) and **up** is `−r1` (image y points down). A truncated file throws `SkipCrop`.

### `ReadPoints(points3D.bin)`
Returns every sparse point position, skipping colour, error and track data. It returns an empty list if the file is missing.

### `PickModelDir(sparseDir)`
Among `sparse/` and its subfolders that contain `images.bin`, it picks the one whose leading `uint64` image count is largest. That is the reconstruction Brush trains on.

### `ClosestPointToRays(cameras)`
Least-squares point nearest every viewing ray. It solves `Σ(I − ddᵀ)·p = Σ(I − ddᵀ)·c` and returns `nullopt` if the matrix is singular (determinant below 1e-12).

### `RayMiss(camera, p)`
Returns the perpendicular distance from `p` to the camera's ray, and whether `p` is in front of the camera.

### `FindCentre(cameras, inliers&)`
1. If the average view vector is longer than 0.95, it skips: all photos face one way.
2. Runs **4 rounds** of solving for the closest point, then keeping cameras that are in front and miss by no more than **2 × the median miss**. If fewer than 8 inliers remain, it skips.
3. It skips if the inlier share is below 60%, or if the median miss divided by the median distance is above 0.3.

### `BuildRegion(inliers, centre, heightFactor, points)`
- **Up** is the normalised sum of the camera up vectors. A horizontal basis `e1, e2` is built by crossing it with an axis that is not parallel.
- It projects the camera centres onto the horizontal plane. `horizontalDistance` is the median radius; zero means the cameras are directly above or below, which skips.
- **Arc** is `360° − LargestGapDegrees(angles)`. Below 90° it skips.
- **Outline:** cameras within 2.5 × the median radius, plus their **mirror images through the centre**, which closes a half-orbit. `ConvexHull` (Andrew's monotone chain) then gives the shape, and `RadialProfile(hull, 720)` gives the hull radius in each direction by intersecting a ray with every edge.
- `SetHeightLimits(...)` uses the median camera height and `cap = heightFactor × horizontalDistance`.

### `SetHeightLimits(region, points, centre, cameraHeight, cap)`
Bins the sparse points that fall inside the footprint and within ±cap into layers of thickness `0.05 × horizontalDistance`. Starting at the cameras' layer, it walks up (and separately down) **to the first nearly empty layer**, keeps going while the counts keep falling and are not zero, and cuts at the far side of that layer. If no point is inside, it keeps ±cap.

### `Inside(region, centre, point)` / `InsideFootprint(region, v)`
`Inside` checks that the height (`v · up`) is within `[low, high]` and calls `InsideFootprint`. That function projects onto `e1`/`e2`, finds the angle bin and compares the radius with `profile[bin]`.

### `Turn`, `ConvexHull`, `RadialProfile`, `LargestGapDegrees`, `Median`, `Normalized`, `ReadAll`
2D geometry and small utilities that support the steps above. `LargestGapDegrees` wraps the angles into 0…2π, sorts them, and returns the largest gap between neighbours, including the wrap-around gap.

### `CropPly(input, output, region, centre, minKeep, kept&, total&)`
Parses the binary little-endian, all-float PLY header (it removes both `\n` and `\r`, and records which header line holds `element vertex`). It checks the file size against the declared count, reads all rows and keeps the indices of rows that are `Inside`. If fewer than `minKeep` (5%) of the splats would be kept, it **skips**. Otherwise it rewrites the vertex count line and writes the header plus the kept rows atomically with `QSaveFile`.
