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

#include "ui/AssetPaths.h"
#include "ui/ImGuiQtBackend.h"
#include "splat/SplatRenderer.h"

#include "splat/SplatModel.h"

#include <imgui.h>
#include <ImGuizmo.h>
#include <imgui_impl_opengl3.h>

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>

#include <QKeyEvent>
#include <QMouseEvent>
#include <QWheelEvent>

#include <stdexcept>
#include <string>

namespace {
    // Qt reports a wheel notch as 120 units of angle delta.
    constexpr double kWheelNotch = 120.0;
    // Overlay layout, shared so the stats window can sit below the tool buttons.
    constexpr float kOverlayPad = 10.0f;
    constexpr float kToolButtonHeight = 26.0f;
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
    m_cropBoxRenderer.reset();
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
    m_cropBoxRenderer = std::make_unique<CropBoxRenderer>();
    BindInputs();

    // ImGui setup -- foundation for the sandbox UI in later milestones.
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    // Keep imgui.ini in the per-user data folder: the working directory of an
    // installed copy is often read-only (Program Files) or arbitrary.
    static const std::string iniPath =
        (AssetPaths::UserDataDir() + "/imgui.ini").toStdString();
    ImGui::GetIO().IniFilename = iniPath.c_str();
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
            Nudge(manager, type, &SplatRenderer::NudgeSplatForward, glm::vec3(1.0f, 0.0f, 0.0f));
        });
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::BACKSWARD,
        [this](InputManager& manager, InputManager::INPUT_TYPE type) {
            Nudge(manager, type, &SplatRenderer::NudgeSplatBackwards, glm::vec3(-1.0f, 0.0f, 0.0f));
        });
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::LEFT,
        [this](InputManager& manager, InputManager::INPUT_TYPE type) {
            Nudge(manager, type, &SplatRenderer::NudgeSplatLeft, glm::vec3(0.0f, 0.0f, -1.0f));
        });
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::RIGHT,
        [this](InputManager& manager, InputManager::INPUT_TYPE type) {
            Nudge(manager, type, &SplatRenderer::NudgeSplatRight, glm::vec3(0.0f, 0.0f, 1.0f));
        });
}

void Viewport::Nudge(InputManager& manager, InputManager::INPUT_TYPE type, NudgeFunction nudge, const glm::vec3& boxDirection) {



    constexpr float kNudgeStep = 0.1f; //Same step as SplatRenderer's model nudge

    SplatModel* model = m_renderer->GetModel(m_renderer->GetSelectedModel());

    if (type == InputManager::RELEASE) {
        //The last nudge key coming up ends the burst
        if (m_nudgeKeysDown > 0 && --m_nudgeKeysDown == 0) FinishNudge();
        return;
    }

    //If crop box active, nudge it instead of the model
    const bool toCropBox = m_cropBox.active;

    //No model or cropbox active
    if (!toCropBox && !model)
        return;
    //If model is being dragged disable nudges
    else if (m_gizmoWasUsing)
    {
        if (m_nudgeActive)
        {
            FinishNudge();
            m_nudgeKeysDown = 0;
        }
        return;
    }

    //The target changed midburst nudges, finish old burst first
    //Box shown or hidden, another model selected
    if (m_nudgeActive && (m_nudgeIsCropBox != toCropBox || (!toCropBox && m_nudgeModel != model))) {
        FinishNudge();
        m_nudgeKeysDown = 0;
    }
    if (!m_nudgeActive) {
        m_nudgeActive = true;
        m_nudgeIsCropBox = toCropBox;
        m_nudgeModel = toCropBox ? nullptr : model;
        m_nudgeBefore = toCropBox ? m_cropBox.transform : model->GetTransform();
        //Only a confirmed selection is carried, otherwise only the box moves
        m_nudgeMovesContents = toCropBox && m_cropBox.moveContents && m_renderer->HasSelection();
    }
    //Key repeat arrives as HOLD, only the real press counts as a key going down
    if (type == InputManager::PRESS) ++m_nudgeKeysDown;

    if (toCropBox) {
        //Worldspace step, the same as the gizmo's translate
        m_cropBox.transform = glm::translate(glm::mat4(1.0f), boxDirection * kNudgeStep) * m_cropBox.transform;
        if (m_nudgeMovesContents) {
            m_renderer->SetRegionPreview(m_cropBox.transform * glm::inverse(m_nudgeBefore));
        }
    }
    else {
        (m_renderer.get()->*nudge)(manager, type);
    }
}

void Viewport::FinishNudge() {
    if (!m_nudgeActive) return;
    m_nudgeActive = false;

    if (m_nudgeIsCropBox) {
        //The preview is replaced by the real splat move that the callback bakes
        if (m_nudgeMovesContents) m_renderer->ClearRegionPreview();
        m_nudgeMovesContents = false;
        if (m_cropBox.transform != m_nudgeBefore && onCropBoxEdited) {
            onCropBoxEdited(m_nudgeBefore, m_cropBox.transform);
        }
        return;
    }

    SplatModel* model = m_nudgeModel;
    m_nudgeModel = nullptr;
    //Only report if the model is still there and actually moved
    if (model && model == m_renderer->GetModel(m_renderer->GetSelectedModel())
        && model->GetTransform() != m_nudgeBefore && onTransformEdited) {
        onTransformEdited(model, m_nudgeBefore, model->GetTransform());
    }
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

    const glm::mat4 view = m_camera.getView();
    const glm::mat4 proj = m_camera.getProjection(aspect);
    //Draw Splat/Pointcloud models
    m_renderer->Draw(view, proj, static_cast<float>(fbWidth), static_cast<float>(fbHeight), m_camera.getPosition());
    if (m_cropBox.active) {
        //Green when the gizmo moves the contents, otherwise orange for removing the inside and blue when keeping it
        glm::vec3 color = m_cropBox.removeInside ? glm::vec3(1.0f, 0.55f, 0.1f) : glm::vec3(0.2f, 0.7f, 1.0f);
        if (m_cropBox.moveContents) color = glm::vec3(0.3f, 1.0f, 0.4f);
        m_cropBoxRenderer->Draw(proj * view, m_cropBox.transform, color);
    }

    ImGui_ImplOpenGL3_NewFrame();
    ImGuiQtBackend::NewFrame(*this, deltaTime);
    ImGui::NewFrame();
    DrawGizmo(view, proj); //Draw Gizmos (Movement arrows, etc.)
    DrawToolButtons();
    DrawImGui(fps);
    ImGui::Render();
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

    if (onStats) {
        onStats(fps, m_renderer->TotalSplatCount());
    }

    // Schedule the next frame; swaps are vsync paced.
    update();
}

void Viewport::DrawGizmo(const glm::mat4& view, const glm::mat4& proj) {
    //BeginFrame must run every frame so ImGuizmo's hover/active state stays current.
    ImGuizmo::BeginFrame();

    SplatModel* model = m_renderer->GetModel(m_renderer->GetSelectedModel());

    //An active crop box takes over the gizmo from the selected model
    const bool editingBox = m_cropBox.active;

    //Pan mode has no gizmo, left drag belongs to the camera
    const InputManager::TOOL_MODE toolMode = m_input.GetToolMode();
    if ((!editingBox && (!model || model->GetIsHidden())) || toolMode == InputManager::PAN) {
        //Nothing dragged, reset drag vars
        m_gizmoWasUsing = false;
        m_dragModel = nullptr;
        m_dragIsCropBox = false;
        m_dragMovesContents = false;
        m_dragBefore = glm::mat4(1.0f);
        m_renderer->ClearRegionPreview();
        return;
    }

    // io.DisplaySize is in widget (logical) pixels, the same space as the mouse.
    const ImVec2 displaySize = ImGui::GetIO().DisplaySize;
    ImGuizmo::SetOrthographic(false);
    ImGuizmo::SetRect(0.0f, 0.0f, displaySize.x, displaySize.y);

    //Get orginal transform of whatever is being edited. Kept separate from the copy ImGuizmo edits, because
    //the first frame of a drag has already moved it by the time IsUsing() reports true.
    const glm::mat4 original = editingBox ? m_cropBox.transform : model->GetTransform();
    glm::mat4 transform = original;

    //Gizmo operation follows the active tool mode
    ImGuizmo::OPERATION operation = ImGuizmo::TRANSLATE;
    if (toolMode == InputManager::ROTATE) operation = ImGuizmo::ROTATE;
    else if (toolMode == InputManager::SCALE) operation = ImGuizmo::SCALE;

    //The box rotates and scales along its own axes so it can be fitted to a rotated region
    const ImGuizmo::MODE space = (editingBox && operation != ImGuizmo::TRANSLATE) ? ImGuizmo::LOCAL : ImGuizmo::WORLD;

    //ImGUIzmo method to edit the transform values
    //view, projection, operation type, local/world, transform value
    if (ImGuizmo::Manipulate(glm::value_ptr(view), glm::value_ptr(proj), operation,
                             space, glm::value_ptr(transform)))
    {
        //Apply transform value
        if (editingBox) m_cropBox.transform = transform;
        else model->SetTransform(transform);
    }

    //A whole drag is one undo ste,: remember where it started and report it once it ends
    //The target is moved live during the drag, only the finished drag goes to the undo stack.
    const bool isUsing = ImGuizmo::IsUsing();
    if (isUsing && !m_gizmoWasUsing) {
        m_dragIsCropBox = editingBox;
        m_dragModel = editingBox ? nullptr : model;
        m_dragBefore = original;
        //Only a confirmed selection is carried, otherwise the drag just moves the box
        m_dragMovesContents = editingBox && m_cropBox.moveContents && m_renderer->HasSelection();
    }
    else if (!isUsing && m_gizmoWasUsing) {
        if (m_dragIsCropBox) {
            if (editingBox && m_cropBox.transform != m_dragBefore && onCropBoxEdited) {
                onCropBoxEdited(m_dragBefore, m_cropBox.transform);
            }
        }
        else if (m_dragModel == model && model && model->GetTransform() != m_dragBefore && onTransformEdited) {
            onTransformEdited(model, m_dragBefore, model->GetTransform());
        }
        m_dragModel = nullptr;
        m_dragIsCropBox = false;
        m_dragMovesContents = false;
        m_renderer->ClearRegionPreview(); //The callback above has baked the move into the splat data
    }
    m_gizmoWasUsing = isUsing;

    //While the box is dragged with a confirmed selection, draw the selected splats moving with it.
    //The splat data itself is only changed once the drag ends.
    if (isUsing && m_dragMovesContents) {
        m_renderer->SetRegionPreview(m_cropBox.transform * glm::inverse(m_dragBefore));
    }
}

void Viewport::DrawToolButtons() {
    static const char* const kLabels[] = { "Pan", "Move", "Rotate", "Scale" };
    static const char* const kTooltips[] = { "Pan (Q)", "Translate (W)", "Rotate (E)", "Scale (R)" };
    constexpr int kModeCount = 4;
    constexpr float kButtonWidth = 60.0f;

    const ImVec2 displaySize = ImGui::GetIO().DisplaySize;
    ImGui::SetNextWindowPos(ImVec2(displaySize.x, kOverlayPad), ImGuiCond_Always, ImVec2(1.0f, 0.0f));
    ImGui::SetNextWindowBgAlpha(0.45f);
    //Unlike the stats overlay this one takes input, so ImGui captures clicks on it and they never reach the camera
    ImGui::Begin("Tool Buttons", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_AlwaysAutoResize |
                 ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoFocusOnAppearing |
                 ImGuiWindowFlags_NoNav);
    for (int i = 0; i < kModeCount; ++i) {
        const auto mode = static_cast<InputManager::TOOL_MODE>(i);
        const bool active = m_input.GetToolMode() == mode;
        if (active) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.2f, 0.45f, 0.8f, 1.0f));
        if (ImGui::Button(kLabels[i], ImVec2(kButtonWidth, kToolButtonHeight))) {
            m_input.SetToolMode(mode);
        }
        if (active) ImGui::PopStyleColor();
        ImGui::SetItemTooltip("%s", kTooltips[i]);
        if (i < kModeCount - 1) ImGui::SameLine();
    }
    ImGui::End();
}

void Viewport::DrawImGui(float fps) {
    if (!m_showImGuiStats) {
        return;
    }

    // Read-only stats overlay pinned to the top-right corner, below the tool buttons.
    // NoInputs keeps it from ever capturing the mouse, so it never blocks camera drags.
    const ImVec2 displaySize = ImGui::GetIO().DisplaySize;
    const float buttonsBottom = kOverlayPad + kToolButtonHeight + ImGui::GetStyle().WindowPadding.y * 2.0f;
    ImGui::SetNextWindowPos(ImVec2(displaySize.x - kOverlayPad, buttonsBottom + 6.0f), ImGuiCond_Always, ImVec2(1.0f, 0.0f));
    ImGui::SetNextWindowBgAlpha(0.45f);
    ImGui::Begin("Engine Stats", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_AlwaysAutoResize |
                 ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoFocusOnAppearing |
                 ImGuiWindowFlags_NoNav | ImGuiWindowFlags_NoInputs);
    ImGui::Text("%.1f FPS (%.2f ms)", fps, fps > 0.0f ? 1000.0f / fps : 0.0f);
    ImGui::Separator();
    ImGui::Text("Models: %zu / %d", m_renderer->ModelCount(), SplatRenderer::kMaxModels);
    ImGui::Text("Splats: %zu", m_renderer->TotalSplatCount());
    static const char* const kToolNames[] = { "Pan", "Translate", "Rotate", "Scale" };
    ImGui::Text("Tool:   %s", kToolNames[m_input.GetToolMode()]);
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

    //Gizmo was hovered on the last frame
    //This click grabs an arrow not move the camera.
    if (event->button() == Qt::LeftButton && (ImGuizmo::IsOver() || ImGuizmo::IsUsing())) return;

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
    //The key release will never arrive, so close any nudge burst here
    if (m_glInitialized) {
        m_nudgeKeysDown = 0;
        FinishNudge();
    }
}
