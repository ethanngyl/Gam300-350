/*!************************************************************************
\file Viewport.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 01-10-2026
\brief
Implements Viewport: initialises GLEW/OpenGL and the splat renderer, drives
the continuous vsync-paced render loop, forwards Qt mouse/keyboard input to
the ImGui overlay and the orbit camera, and draws the ImGui "Engine Stats"
overlay. Loading and editing splats is done by the Qt editor panels.
**************************************************************************/
#include "ui/Viewport.h"

#include "ui/ImGuiQtBackend.h"
#include "splat/SplatRenderer.h"

#include <imgui.h>
#include <imgui_impl_opengl3.h>

#include <glm/glm.hpp>

#include <QKeyEvent>
#include <QMouseEvent>
#include <QWheelEvent>

#include <stdexcept>
#include <string>

namespace {
    // Qt reports a wheel notch as 120 units of angle delta.
    constexpr double kWheelNotch = 120.0;
}

Viewport::Viewport(QWidget* parent)
    : QOpenGLWidget(parent) {
    setFocusPolicy(Qt::StrongFocus);
    setMouseTracking(true); // ImGui needs hover positions, not just drags
}

Viewport::~Viewport() {
    if (!m_glInitialized) {
        return;
    }
    // GL resources must be released with this widget's context current.
    makeCurrent();
    m_renderer.reset();
    ImGui_ImplOpenGL3_Shutdown();
    ImGuiQtBackend::Shutdown();
    ImGui::DestroyContext();
    doneCurrent();
}

void Viewport::initializeGL() {
    glewExperimental = GL_TRUE;
    GLenum glewStatus = glewInit();
    if (glewStatus != GLEW_OK) {
        std::string message = reinterpret_cast<const char*>(glewGetErrorString(glewStatus));
        throw std::runtime_error("Failed to initialize GLEW: " + message);
    }

    glEnable(GL_DEPTH_TEST);
    glEnable(GL_PROGRAM_POINT_SIZE);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    m_renderer = std::make_unique<SplatRenderer>();
    BindInputs();

    // ImGui setup -- foundation for the sandbox UI in later milestones.
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGui::StyleColorsDark();
    ImGuiQtBackend::Init();
    ImGui_ImplOpenGL3_Init("#version 330");

    m_glInitialized = true;
    m_frameTimer.start();

    if (onInitialized) {
        onInitialized();
    }
}

void Viewport::BindInputs() {
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::LEFT_CLICK,
        [this](InputManager& manager, InputManager::INPUT_TYPE type) {
            m_camera.ProcessLeftClick(manager, type);
        });
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::RIGHT_CLICK,
        [this](InputManager& manager, InputManager::INPUT_TYPE type) {
            m_camera.ProcessRightClick(manager, type);
        });
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::SCROLL,
        [this](InputManager& manager, InputManager::INPUT_TYPE type) {
            m_camera.ProcessScroll(manager, type);
        });

    //Movmeent test
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::FORWARD,
        [this](InputManager& manager, InputManager::INPUT_TYPE type) {
            m_renderer->NudgeSplatForward(manager, type);
        });
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::BACKSWARD,
        [this](InputManager& manager, InputManager::INPUT_TYPE type) {
            m_renderer->NudgeSplatBackwards(manager, type);
        });
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::LEFT,
        [this](InputManager& manager, InputManager::INPUT_TYPE type) {
            m_renderer->NudgeSplatLeft(manager, type);
        });
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::RIGHT,
        [this](InputManager& manager, InputManager::INPUT_TYPE type) {
            m_renderer->NudgeSplatRight(manager, type);
        });
}

void Viewport::paintGL() {
    float deltaTime = static_cast<float>(m_frameTimer.nsecsElapsed()) / 1.0e9f;
    m_frameTimer.restart();
    float fps = deltaTime > 0.0f ? 1.0f / deltaTime : 0.0f;

    const float dpr = static_cast<float>(devicePixelRatioF());
    const int fbWidth = static_cast<int>(width() * dpr);
    const int fbHeight = static_cast<int>(height() * dpr);
    float aspect = fbHeight > 0 ? static_cast<float>(fbWidth) / static_cast<float>(fbHeight) : 1.0f;

    glClearColor(0.05f, 0.05f, 0.08f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    m_renderer->Draw(m_camera.getView(), m_camera.getProjection(aspect),
                     static_cast<float>(fbWidth), static_cast<float>(fbHeight), m_camera.getPosition());

    ImGui_ImplOpenGL3_NewFrame();
    ImGuiQtBackend::NewFrame(*this, deltaTime);
    ImGui::NewFrame();
    DrawImGui(fps);
    ImGui::Render();
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

    if (onStats) {
        onStats(fps, m_renderer->TotalSplatCount());
    }

    // Schedule the next frame; swaps are vsync paced.
    update();
}

void Viewport::DrawImGui(float fps) {
    if (!m_showImGuiStats) {
        return;
    }

    // Read-only stats overlay pinned to the top-right corner. NoInputs keeps
    // it from ever capturing the mouse, so it never blocks camera drags.
    constexpr float kPad = 10.0f;
    const ImVec2 displaySize = ImGui::GetIO().DisplaySize;
    ImGui::SetNextWindowPos(ImVec2(displaySize.x - kPad, kPad), ImGuiCond_Always, ImVec2(1.0f, 0.0f));
    ImGui::SetNextWindowBgAlpha(0.45f);
    ImGui::Begin("Engine Stats", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_AlwaysAutoResize |
                 ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoFocusOnAppearing |
                 ImGuiWindowFlags_NoNav | ImGuiWindowFlags_NoInputs);
    ImGui::Text("%.1f FPS (%.2f ms)", fps, fps > 0.0f ? 1000.0f / fps : 0.0f);
    ImGui::Separator();
    ImGui::Text("Models: %zu / %d", m_renderer->ModelCount(), SplatRenderer::kMaxModels);
    ImGui::Text("Splats: %zu", m_renderer->TotalSplatCount());
    ImGui::Text("Mode:   %s", m_renderer->GetRenderMode() == SplatRenderer::RenderMode::GaussianSplat
                                  ? "Gaussian Splat" : "Point Cloud");
    ImGui::End();
}

// ---------------------------------------------------------------------------
// Input: every event goes to ImGui first; the engine only sees it when ImGui
// does not want it (e.g. dragging on a panel does not orbit the camera).
// ---------------------------------------------------------------------------

void Viewport::mousePressEvent(QMouseEvent* event) {
    if (!m_glInitialized) return;
    ImGuiQtBackend::ProcessMouseButton(*event, true);
    m_lastMousePos = event->position();
    if (ImGui::GetIO().WantCaptureMouse) return;

    m_input.CallbackMouseClick(event->button(), InputManager::PRESS, 0.0, 0.0);
    if (event->button() == Qt::LeftButton) m_leftHeld = true;
    else if (event->button() == Qt::RightButton) m_rightHeld = true;
}

void Viewport::mouseReleaseEvent(QMouseEvent* event) {
    if (!m_glInitialized) return;
    ImGuiQtBackend::ProcessMouseButton(*event, false);
    if (event->button() == Qt::LeftButton) m_leftHeld = false;
    else if (event->button() == Qt::RightButton) m_rightHeld = false;
}

void Viewport::mouseMoveEvent(QMouseEvent* event) {
    if (!m_glInitialized) return;
    ImGuiQtBackend::ProcessMouseMove(*event);

    const QPointF pos = event->position();
    const double dx = pos.x() - m_lastMousePos.x();
    const double dy = pos.y() - m_lastMousePos.y();
    m_lastMousePos = pos;

    if (m_rightHeld) m_input.CallbackMouseClick(Qt::RightButton, InputManager::HOLD, dx, dy);
    if (m_leftHeld) m_input.CallbackMouseClick(Qt::LeftButton, InputManager::HOLD, dx, dy);
}

void Viewport::wheelEvent(QWheelEvent* event) {
    if (!m_glInitialized) return;
    ImGuiQtBackend::ProcessWheel(*event);
    if (ImGui::GetIO().WantCaptureMouse) return;
    m_input.CallbackMouseScroll(event->angleDelta().y() / kWheelNotch);
}

void Viewport::keyPressEvent(QKeyEvent* event) {
    if (!m_glInitialized) return;
    ImGuiQtBackend::ProcessKey(*event, true);
    if (ImGui::GetIO().WantCaptureKeyboard) return;
    m_input.CallbackKeyPress(event->key(), event->isAutoRepeat() ? InputManager::HOLD : InputManager::PRESS);
}

void Viewport::keyReleaseEvent(QKeyEvent* event) {
    if (!m_glInitialized) return;
    ImGuiQtBackend::ProcessKey(*event, false);
    // Qt sends a release before every auto-repeat press; only report the real one.
    if (event->isAutoRepeat() || ImGui::GetIO().WantCaptureKeyboard) return;
    m_input.CallbackKeyPress(event->key(), InputManager::RELEASE);
}

void Viewport::focusInEvent(QFocusEvent* event) {
    QOpenGLWidget::focusInEvent(event);
    if (m_glInitialized) ImGuiQtBackend::ProcessFocus(true);
}

void Viewport::focusOutEvent(QFocusEvent* event) {
    QOpenGLWidget::focusOutEvent(event);
    if (m_glInitialized) ImGuiQtBackend::ProcessFocus(false);
    m_leftHeld = false;
    m_rightHeld = false;
}
