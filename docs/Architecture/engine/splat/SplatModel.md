# `splat/SplatModel.h` / `SplatModel.cpp`

*Author: Clement.* One model in the scene: its splats, transform, name, trim state and visibility. The class is header-only; `SplatModel.cpp` only includes the header. [SplatRenderer](SplatRenderer.md) owns the models and builds the combined GPU buffer from them.

## Members
| Member | Meaning |
|---|---|
| `m_splats` | Current splat data, which may be trimmed or edited. |
| `m_original` | Untrimmed copy, kept so the model can be trimmed again with other settings. Empty until the model is first trimmed. |
| `m_trimData`, `m_trimmed` | Settings of the last trim, and whether the model has been trimmed at all. |
| `m_transform` | Model-to-world matrix. |
| `m_name` | Display name. |
| `isHidden` | Visibility. |
| `m_vao`, `m_vbo`, `m_count`, `m_shader` | Not used. They are left over from when each model drew itself; the renderer now draws every model from one buffer. |

## Functions

### Splat data
- `SetSplat(const std::vector<SplatVertex>&)` replaces the current splats.
- `splats()` returns them; `GetCount()` returns how many there are.

### Original (untrimmed) data
- `SetOriginal(std::vector<SplatVertex>&&)` moves in an untrimmed copy.
- `KeepOriginal()` copies the current splats into `m_original`, **only if no original is stored yet**. It is called just before the first trim.
- `SourceSplats()` returns the original if there is one, otherwise the current splats. A new trim always starts from this.

### Trim state
`SetTrimData(const TrimData&, bool trimmed)`, `GetTrimData()` and `IsTrimmed()`. See [SplatTrimmer](SplatTrimmer.md).

### Identity and transform
- `SetName`, `GetName`.
- `SetTransform(mat4)`, `GetTransform()`.
- `Translate(vec3)`, `Scale(vec3)` and `Rotate(angle, axis)` each apply the glm operation to the **current** matrix, in the model's local frame (post-multiplied).

### Visibility
`SetHidden(bool)` and `GetIsHidden()`. Code should call `SplatRenderer::SetModelHidden` instead of `SetHidden` directly, so the draw buffer gets rebuilt.
