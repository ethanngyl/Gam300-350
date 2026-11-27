# `splat/CropBox.h` / `CropBox.cpp`

The **crop box**: an editor-only oriented box used to select a region of splats so they can be removed or moved. The box is a unit cube centred on the origin (`[-0.5, 0.5]` on every axis), placed in the world by one matrix, so it is translated, rotated and scaled exactly like a `SplatModel`. It is drawn by [gfx/CropBoxRenderer](../gfx/CropBoxRenderer.md).

## `struct CropBox`
| Field | Default | Meaning |
|---|---|---|
| `transform` | identity | World placement of the unit cube. |
| `active` | false | The box is shown and the gizmo edits it. |
| `removeInside` | true | True removes splats inside the box; false removes everything outside. |
| `moveContents` | false | True makes gizmo drags carry the splats inside the box; false edits the box itself. |

## Functions

### `std::vector<uint8_t> ComputeCropKeepMask(splats, modelTransform, box)`
Returns one byte per splat (1 = keep, 0 = remove). If the box is flat (`|det| < 1e-12`, so it cannot be inverted), it keeps everything. Otherwise it builds `toBox = inverse(box.transform) · modelTransform` **once**, so each splat costs one matrix multiply and an `|x|,|y|,|z| ≤ 0.5` test. Splats inside get 0 when `removeInside` is set and 1 otherwise; splats outside get the opposite.

### `glm::mat4 FitCropBoxToSplats(splats, modelTransform)`
The starting box. It computes the world-space AABB of all splats and returns `translate(centre) · scale(halfExtent)`. Because the unit cube spans ±0.5, scaling by half the extent makes the box cover **roughly the middle half** of the model. Each axis is kept at least 0.01, so a perfectly flat scan still gets a usable box. It returns identity when there are no splats.

### `std::vector<uint32_t> CollectSplatsInBox(splats, modelTransform, boxTransform)`
Returns the ascending indices of splats inside the box, using the same inverse-transform test. A flat box returns an empty list. Used for "select splats in box" and for carrying the box contents.

### `glm::mat4 WorldDeltaToModelSpace(deltaWorld, modelTransform)`
Returns `inverse(model) · delta · model`. It turns a world-space change (`newBox · inverse(oldBox)`) into the same change in a model's own space, so it can be applied to the splat positions stored in model space.

### `bool DecomposeRegionDelta(delta, glm::mat3& rotation, float& factor)`
Splits the 3×3 part of `delta` into a pure rotation (each column divided by its length) and **one average scale factor**, `cbrt(sx·sy·sz)`, the cube root of the volume change. It returns false, leaving identity and 1, if any axis length is below 1e-8 (squashed flat).

### `SplatVertex TransformSplat(splat, deltaModel)`
Applies a model-space transform to one splat:
- The position is multiplied by `deltaModel`.
- If the decomposition succeeds, the orientation becomes `normalize(quat(rotation) · current)`, converted between the stored (w,x,y,z) order and glm's quaternion order, and `scale` and `pointSize` are multiplied by the average factor. A non-uniform scale is therefore only approximated.
- If the transform is squashed flat, only the position changes.
