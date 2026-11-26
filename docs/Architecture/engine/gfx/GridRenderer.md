# `gfx/GridRenderer.h` / `GridRenderer.cpp`

Draws the editor's reference grid on the ground plane (`y = 0`), with the world axes on top of it: **X red, Y green, Z blue**. It is drawn before the models, with depth testing off, so the models always cover it.

## Constants

| Constant | Value | Meaning |
|---|---|---|
| `kExtent` | 10 | The grid spans −10…10 on X and Z. |
| `kMinorPerUnit` | 4 | Thin lines per world unit. It must be a whole number so every 4th line lands exactly on a unit (enforced by `static_assert`). |
| `kMinorStep` | 0.25 | Spacing of the thin lines. |
| `kFadeStart` | 6 (0.6 × extent) | Lines start fading here and are fully gone at `kExtent`. The viewport's grid labels also stop here. |

## Internal helpers (anonymous namespace)

- **`struct Vertex { vec3 position; vec4 color; }`**: interleaved vertex layout.
- **`AddLine(out, a, b, color)`**: appends two vertices that form one line.
- **`AddAxis(out, direction, color)`**: draws an axis through the origin. The positive half has 0.95 alpha and the negative half has 0.45 alpha, so you can tell which way is positive.
- **`BuildGrid()`**: for each `i` from `-steps` to `steps` (where `steps = round(extent * 4)`), it skips `i == 0` (the axes go there) and adds one line parallel to X and one parallel to Z at `c = i * 0.25`. Every `kMinorPerUnit`-th line gets the brighter *major* colour. It then adds the three axes. The colours are locals rather than file-scope globals, so no static initialiser can throw (this satisfies the clang-tidy rule `bugprone-throwing-static-initialization`).

## Shaders
- Vertex: passes the colour and world position through, and outputs `uViewProj * pos`.
- Fragment: `edge = max(|x|, |z|)`, `fade = 1 - smoothstep(uFadeStart, uExtent, edge)`, and the output alpha is the vertex alpha times `fade`. This gives a soft edge instead of a hard border.

## Functions

### `GridRenderer()`
Compiles the shader, builds the vertices with `BuildGrid()`, uploads them to a VBO, and sets attribute 0 (position) and attribute 1 (colour) using `offsetof`.

### `~GridRenderer()`
Deletes the VBO and VAO.

### `void Draw(const glm::mat4& viewProj)`
Sets the uniforms, turns off depth testing **and depth writes**, and draws `m_vertexCount` vertices as `GL_LINES`. It then turns depth writes back on. Depth writes stay off during the grid so it never hides later overlays such as the crop box or gizmos.
