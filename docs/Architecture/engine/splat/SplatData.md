# `splat/SplatData.h`

Defines `SplatVertex`, the decoded, GPU-ready form of one Gaussian splat, and the `splat_decode` helpers that turn raw `.ply` fields into it. Every splat module and the renderer use these.

## `struct SplatVertex`

| Field | Source `.ply` fields | Meaning |
|---|---|---|
| `glm::vec3 position` | `x, y, z` | Position in model space. The loader flips y. |
| `float pointSize` | `scale_0..2` | World-space radius, `exp(average log scale)`. Used in point-cloud mode. |
| `glm::vec3 color` | `f_dc_0..2` | RGB from the spherical-harmonics DC term. |
| `float alpha` | `opacity` | Opacity after the sigmoid. |
| `float modelID` | — | Index of the owning model in the renderer's combined buffer. |
| `glm::vec3 scale` | `scale_0..2` | Standard deviation of the Gaussian per axis, in world units. |
| `glm::vec4 rotation` | `rot_0..3` | Unit orientation quaternion stored as **(w, x, y, z)**. |

The higher-order spherical-harmonics fields `f_rest_0..44` are not used. Splats are drawn view-independent.

## `namespace splat_decode`

| Function | Formula |
|---|---|
| `kShC0` | `0.28209479177387814`, the SH band-0 constant. |
| `float decodeScale(float logScale)` | `exp(logScale)`. The file stores log scales. |
| `glm::vec4 decodeRotation(w, x, y, z)` | Normalises the quaternion. Near-zero length (< 1e-8) returns identity `(1,0,0,0)`. |
| `float decodeOpacity(float raw)` | Sigmoid: `1 / (1 + e^−raw)`. |
| `glm::vec3 decodeColor(f0, f1, f2)` | `0.5 + kShC0 · f` per channel. |
