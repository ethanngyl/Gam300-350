/******************************************************************************
 * File:        WebMain.cpp
 * Project:     Genesis
 * Author(s):	Ethan Ng Yong Le   (Primary, 100%)
 *
 * Description:
 * WebAssembly entry point for the engine renderer. Compiles the same SplatLoader,
 * SplatRenderer, Shader and Camera the desktop editor uses (with CODEFINE_GLES so they
 * target WebGL2) and exposes them to the web app as a small C API. The web app owns the
 * canvas, input events and render loop (see packages/src/web-app/EngineSplatViewer.jsx).
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#include "splat/SplatLoader.h"
#include "splat/SplatRenderer.h"
#include "gfx/Camera.h"

#include <emscripten/emscripten.h>
#include <emscripten/html5.h>
#include <GLES3/gl3.h>

#include <iostream>
#include <memory>
#include <vector>

namespace {

EMSCRIPTEN_WEBGL_CONTEXT_HANDLE g_context = 0;
std::unique_ptr<SplatRenderer> g_renderer;
std::unique_ptr<Camera> g_camera;

} // namespace

extern "C" {

//Creates a WebGL2 context on the canvas matching canvasSelector (e.g. "#engine-canvas")
//and the renderer. Returns 1 on success, 0 if WebGL2 is unavailable.
EMSCRIPTEN_KEEPALIVE int cf_init(const char* canvasSelector) {
    if (g_context) return 1;

    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
    attrs.majorVersion = 2;
    attrs.minorVersion = 0;
    attrs.alpha = false; //Opaque canvas, so splat blending is not composited with the page
    attrs.depth = true;
    attrs.antialias = false;
    attrs.powerPreference = EM_WEBGL_POWER_PREFERENCE_HIGH_PERFORMANCE;

    g_context = emscripten_webgl_create_context(canvasSelector, &attrs);
    if (g_context <= 0) {
        std::cerr << "[Engine] WebGL2 is not available on " << canvasSelector << std::endl;
        g_context = 0;
        return 0;
    }
    emscripten_webgl_make_context_current(g_context);

    //Same initial state as the desktop Viewport
    glEnable(GL_DEPTH_TEST);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    g_renderer = std::make_unique<SplatRenderer>();
    g_camera = std::make_unique<Camera>();
    return 1;
}

//Parses a .ply held in wasm memory and adds it as a model.
//Returns the splat count, 0 if the file could not be parsed, -1 if the engine is not ready
//or the model limit is reached.
EMSCRIPTEN_KEEPALIVE int cf_load_ply(const unsigned char* data, size_t size, const char* name) {
    if (!g_renderer) return -1;
    if (g_renderer->ModelCount() >= static_cast<size_t>(SplatRenderer::kMaxModels)) {
        std::cerr << "[Engine] model limit (" << SplatRenderer::kMaxModels << ") reached" << std::endl;
        return -1;
    }

    std::vector<SplatVertex> splats = LoadSplatPlyFromMemory(data, size, name);
    if (splats.empty()) return 0;

    const int count = static_cast<int>(splats.size());
    g_renderer->SetSplats(splats, name);
    return count;
}

EMSCRIPTEN_KEEPALIVE void cf_clear() {
    if (!g_renderer) return;
    while (g_renderer->ModelCount() > 0) g_renderer->RemoveModel(0);
}

//0 = point cloud, 1 = Gaussian splat
EMSCRIPTEN_KEEPALIVE void cf_set_render_mode(int mode) {
    if (!g_renderer) return;
    g_renderer->SetRenderMode(mode == 1 ? SplatRenderer::RenderMode::GaussianSplat
                                        : SplatRenderer::RenderMode::PointCloud);
}

EMSCRIPTEN_KEEPALIVE int cf_splat_count() {
    return g_renderer ? static_cast<int>(g_renderer->TotalSplatCount()) : 0;
}

//Camera moves, in CSS pixels (orbit/pan) and wheel notches (zoom), same units as the editor
EMSCRIPTEN_KEEPALIVE void cf_orbit(float dx, float dy) { if (g_camera) g_camera->Orbit(dx, dy); }
EMSCRIPTEN_KEEPALIVE void cf_pan(float dx, float dy) { if (g_camera) g_camera->Pan(dx, dy); }
EMSCRIPTEN_KEEPALIVE void cf_zoom(float notches) { if (g_camera) g_camera->Zoom(notches); }
EMSCRIPTEN_KEEPALIVE void cf_reset_camera() { if (g_camera) g_camera = std::make_unique<Camera>(); }

//Draws one frame into the canvas' drawing buffer (size in device pixels)
EMSCRIPTEN_KEEPALIVE void cf_render(int width, int height) {
    if (!g_renderer || width <= 0 || height <= 0) return;
    emscripten_webgl_make_context_current(g_context);

    glViewport(0, 0, width, height);
    glClearColor(0.05f, 0.05f, 0.08f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    const float aspect = static_cast<float>(width) / static_cast<float>(height);
    g_renderer->Draw(g_camera->getView(), g_camera->getProjection(aspect),
                     static_cast<float>(width), static_cast<float>(height), g_camera->getPosition());
}

//Frees GPU resources and the context. cf_init may be called again afterwards.
EMSCRIPTEN_KEEPALIVE void cf_shutdown() {
    if (!g_context) return;
    emscripten_webgl_make_context_current(g_context);
    g_renderer.reset();
    g_camera.reset();
    emscripten_webgl_destroy_context(g_context);
    g_context = 0;
}

} // extern "C"
