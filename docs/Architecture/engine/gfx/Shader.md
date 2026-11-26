# `gfx/Shader.h` / `Shader.cpp`

RAII wrapper for an OpenGL shader program. It compiles and links GLSL source strings and sets uniforms by name. One codebase serves both desktop GL 3.3 and WebGL2 (GLES 3.0).

## Internal helpers

### `translateForGles(const char* src)` *(only when `CODEFINE_GLES` is defined)*
The shaders are written as desktop `#version 330 core`. For WebGL2, this replaces everything up to and including that line with `#version 300 es` plus `precision highp` lines for float, int and sampler2D. It also removes anything before the `#version` line, because GLES requires `#version` to be the very first line and the raw string literals start with a newline.

### `compileStage(unsigned type, const char* src)`
Translates the source for GLES if needed, then runs `glCreateShader`, `glShaderSource` and `glCompileShader`. If compilation fails, it reads the info log and prints `[Shader] compile error: …` to `stderr`. It returns the shader handle either way.

## Functions

### `Shader(const char* vertexSrc, const char* fragmentSrc)`
Calls the three-stage constructor with no geometry stage.

### `Shader(const char* vertexSrc, const char* geometrySrc, const char* fragmentSrc)`
Compiles the vertex stage, the optional geometry stage and the fragment stage, attaches them to a new program and links it. A link failure prints `[Shader] link error: …`. The stage objects are deleted after linking. On GLES there is no geometry stage, so `geometrySrc` is ignored (the renderer never passes one on that build).

### `~Shader()`
Calls `glDeleteProgram` if the id is not zero. The class is non-copyable.

### `void use() const`
Calls `glUseProgram(m_id)`.

### Uniform setters
Each one calls `glGetUniformLocation(m_id, name)` and then the matching `glUniform*` function:
- `setMat4(name, mat4)`, using column-major order with no transpose.
- `setMat4Array(name, vector<mat4>)`, which loops and sets `name[0]`, `name[1]`, and so on.
- `setFloat`, `setInt`, `setVec2`, `setVec3`.

The program must be bound with `use()` first.

### `unsigned int id() const`
Returns the raw GL program handle.
