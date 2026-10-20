/*!************************************************************************
\file Viewport.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 01-10-2026
\brief
Declares Viewport, the QOpenGLWidget 3D view. It owns the OpenGL context,
the splat renderer, the orbit camera and the ImGui stats overlay, turns Qt
mouse and keyboard events into InputManager events, and repaints
continuously (vsync paced) in place of the old GLFW main loop. Scene editing
(importing, selecting, transforming) is driven by the Qt editor panels
through renderer().
**************************************************************************/
#pragma once

// GLEW must come before any Qt OpenGL header, since those pull in gl.h.
#include <GL/glew.h>

#include "gfx/Camera.h"
#include "Manager/InputManager.h"

#include <QElapsedTimer>
#include <QOpenGLWidget>
#include <QPointF>

#include <cstddef>
#include <functional>
#include <memory>

class SplatRenderer;

// The 3D view. Owns the OpenGL context, the splat renderer and the ImGui
// overlay, and turns Qt input into InputManager events. Repaints
// continuously (vsync paced), replacing the old GLFW main loop.
class Viewport : public QOpenGLWidget {
public:
    explicit Viewport(QWidget* parent = nullptr);
    ~Viewport() override;

    // Engine -> Qt UI: called once per frame with the latest stats.
    std::function<void(float fps, std::size_t splatCount)> onStats;

    // Engine -> Qt UI: called once the GL context and renderer() exist.
    std::function<void()> onInitialized;

    // Qt UI -> ImGui: whether the ImGui "Engine Stats" overlay is drawn.
    void setShowImGuiStats(bool show) { m_showImGuiStats = show; }

    // The scene renderer the editor panels operate on. Null until the GL
    // context exists (i.e. before the widget is first shown).
    SplatRenderer* renderer() const { return m_renderer.get(); }

    // Moves the orbit camera's pan target back to where it started.
    void recenterCamera() { m_camera.ResetPosition(); }

protected:
    void initializeGL() override;
    void paintGL() override;

    void mousePressEvent(QMouseEvent* event) override;
    void mouseReleaseEvent(QMouseEvent* event) override;
    void mouseMoveEvent(QMouseEvent* event) override;
    void wheelEvent(QWheelEvent* event) override;
    void keyPressEvent(QKeyEvent* event) override;
    void keyReleaseEvent(QKeyEvent* event) override;
    void focusInEvent(QFocusEvent* event) override;
    void focusOutEvent(QFocusEvent* event) override;
    // Keep Tab for ImGui instead of Qt's focus chain.
    bool focusNextPrevChild(bool) override { return false; }

private:
    void BindInputs();
    void DrawImGui(float fps);

    Camera m_camera;
    InputManager m_input;
    std::unique_ptr<SplatRenderer> m_renderer; // created once the GL context exists
    bool m_glInitialized = false;

    QElapsedTimer m_frameTimer;
    bool m_showImGuiStats = true;

    // Mouse drags are forwarded to the engine only if they started outside ImGui.
    bool m_leftHeld = false;
    bool m_rightHeld = false;
    QPointF m_lastMousePos;
};
