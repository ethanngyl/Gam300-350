# `gfx/CropBoxRenderer.h` / `CropBoxRenderer.cpp`

Draws the crop box (see [splat/CropBox](../splat/CropBox.md)) as a **wireframe cube** over the scene. The GPU holds one fixed unit cube, and the box's transform matrix places it in the world.

## Internals
- `kCorners`: 8 corners of a unit cube centred on the origin (−0.5…0.5).
- `kEdges`: 24 `unsigned short` indices that make 12 edges (back face, front face, and the 4 edges joining them).
- Shader: the vertex stage computes `uViewProj * uModel * pos`. The fragment stage outputs `uColor` at 0.95 alpha.
- On the WebAssembly build (`CODEFINE_GLES`), it includes `GLES3/gl3.h` instead of GLEW.

## Functions

### `CropBoxRenderer()`
Compiles the shader and creates a VAO, a VBO (corners) and an EBO (edge indices), all `GL_STATIC_DRAW`. Attribute 0 is `vec3` position. Must be called while a GL context is current.

### `~CropBoxRenderer()`
Deletes the EBO, VBO and VAO. The class is non-copyable.

### `void Draw(const glm::mat4& viewProj, const glm::mat4& boxTransform, const glm::vec3& color)`
Binds the shader and sets the three uniforms. It then **turns off depth testing**, so the box shows through every model, draws 24 indices as `GL_LINES`, and turns depth testing back on.
