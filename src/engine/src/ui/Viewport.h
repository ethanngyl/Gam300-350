#pragma once

// GLEW must come before any Qt OpenGL header, since those pull in gl.h.
#include <GL/glew.h>

#include "gfx/Camera.h"
#include "Manager/InputManager.h"

#include <QElapsedTimer>
#include <QOpenGLWidget>
#include <QPointF>

#include <cstddef>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <vector>

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

    // Qt UI -> ImGui: whether the ImGui "Engine Stats" window is drawn.
    void setShowImGuiStats(bool show) { m_showImGuiStats = show; }

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
    bool LoadSplatFile(const std::filesystem::path& path);

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

    // .ply browser state
    std::filesystem::path m_splatDir;
    std::string m_loadedPath;
    std::vector<std::filesystem::path> m_plyFiles;
    int m_selectedIndex = -1; // file highlighted in the browser; -1 = none
};
