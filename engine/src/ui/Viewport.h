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
#include "gfx/CropBoxRenderer.h"
#include "Manager/InputManager.h"
#include "splat/CropBox.h"

#include <glm/glm.hpp>

#include <QElapsedTimer>
#include <QOpenGLWidget>
#include <QPointF>

#include <cstddef>
#include <functional>
#include <memory>

class SplatModel;
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

    // Engine -> Qt UI: called once when a gizmo drag ends with the model's
    // transform before and after the whole drag (not once per frame).
    std::function<void(SplatModel* model, const glm::mat4& before, const glm::mat4& after)> onTransformEdited;

    // Engine -> Qt UI: same as onTransformEdited but for the crop box.
    std::function<void(const glm::mat4& before, const glm::mat4& after)> onCropBoxEdited;

    // Qt UI -> ImGui: whether the ImGui "Engine Stats" overlay is drawn.
    void setShowImGuiStats(bool show) { m_showImGuiStats = show; }

    // The scene renderer the editor panels operate on. Null until the GL
    // context exists (i.e. before the widget is first shown).
    SplatRenderer* renderer() const { return m_renderer.get(); }

    // The crop box. While it is active the gizmo edits it instead of the selected model.
    CropBox& cropBox() { return m_cropBox; }

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
    //Top right row of tool buttons, active tool is highlighted
    void DrawToolButtons();
    //Draws the gizmo on the crop box if it is active, otherwise on the selected model, and writes drags back to it.
    void DrawGizmo(const glm::mat4& view, const glm::mat4& proj);

    using NudgeFunction = void (SplatRenderer::*)(InputManager&, InputManager::INPUT_TYPE);
    //Arrow key nudges the crop box while it is open, otherwise nudge the selected model
    //A burst of nudges (1 key held down, or several keys in a row) is one undo step traccked
    //boxDirection is the world-space direction the same key moves the crop box
    void Nudge(InputManager& manager, InputManager::INPUT_TYPE type, NudgeFunction nudge, const glm::vec3& boxDirection);
    //Reports the finished burst to onTransformEdited
    void FinishNudge();

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

    //Gizmo drag in progress the model
    bool m_gizmoWasUsing = false;
    //Model being dragged
    SplatModel* m_dragModel = nullptr;
    //Orginal location of dragged model (or of the crop box if m_dragIsCropBox)
    glm::mat4 m_dragBefore = glm::mat4(1.0f);
    //The drag in progress is moving the crop box, not a model
    bool m_dragIsCropBox = false;
    //The crop box drag also carries the confirmed splat selection along
    bool m_dragMovesContents = false;

    //Nudge burst in progress: what is being nudged and where it started, and how many nudge keys are down
    bool m_nudgeActive = false;
    bool m_nudgeIsCropBox = false;       //The burst moves the crop box, not m_nudgeModel
    bool m_nudgeMovesContents = false;   //...and carries the confirmed splat selection with it
    SplatModel* m_nudgeModel = nullptr;
    glm::mat4 m_nudgeBefore = glm::mat4(1.0f); //Transform of the model (or crop box) when the burst started
    int m_nudgeKeysDown = 0;

    CropBox m_cropBox;
    std::unique_ptr<CropBoxRenderer> m_cropBoxRenderer; // created once the GL context exists
};
