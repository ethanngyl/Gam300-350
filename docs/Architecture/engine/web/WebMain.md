# `engine/web/WebMain.cpp`

The **WebAssembly entry point** for the engine renderer. It compiles the same `SplatLoader`, `SplatRenderer`, `Shader` and `Camera` the desktop editor uses, with `CODEFINE_GLES` defined so they target WebGL2, and exposes them to JavaScript as a small **C API** (`extern "C"`, `EMSCRIPTEN_KEEPALIVE`). The web app owns the canvas, the input events and the render loop ([frontend/web-app/EngineSplatViewer](../../frontend/web-app/EngineSplatViewer.md)). It is wrapped by the npm package described in [package.md](package.md).

## Globals (anonymous namespace)
`g_context` (the WebGL context handle), `g_renderer` (`unique_ptr<SplatRenderer>`), `g_camera` (`unique_ptr<Camera>`). There is one engine per WASM instance; the JS wrapper creates a separate instance for each canvas.

## Exported functions

| Function | Behaviour |
|---|---|
| `int cf_init(const char* canvasSelector)` | Does nothing (returns 1) if already initialised. Creates a **WebGL 2.0** context on the canvas: `alpha = false` (an opaque canvas, so splat blending is not composited with the page), depth on, no antialiasing, high-performance GPU. Returns 0 if WebGL2 is unavailable. Otherwise it makes the context current, applies the desktop Viewport's GL state (depth test, alpha blending), creates the renderer and camera, and returns 1. |
| `int cf_load_ply(const unsigned char* data, size_t size, const char* name)` | Returns −1 if not initialised or the model limit (32) is reached. Otherwise `LoadSplatPlyFromMemory` parses the bytes; it returns **0 if parsing failed**, else adds the model and returns its splat count. |
| `void cf_clear()` | Removes every model. |
| `void cf_set_render_mode(int mode)` | 1 means Gaussian splat, anything else point cloud. |
| `int cf_splat_count()` | Total splats across all models. |
| `void cf_orbit(dx, dy)` / `cf_pan(dx, dy)` / `cf_zoom(notches)` | Raw camera moves, in CSS pixels or wheel notches, the same units as the editor. |
| `void cf_reset_camera()` | Replaces the camera with a new default `Camera`. |
| `void cf_render(int width, int height)` | Does nothing for zero size. Makes the context current, sets the viewport, clears to the editor's background colour and calls `renderer->Draw(view, proj(aspect), w, h, camPos)`. The width and height are the drawing buffer in **device** pixels. |
| `void cf_shutdown()` | Frees the renderer and camera (so their GL objects are deleted while the context is current), then destroys the context. `cf_init` can be called again afterwards. |
