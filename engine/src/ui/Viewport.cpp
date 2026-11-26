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
#include <QScreen>
#include <QWheelEvent>

#include <algorithm>
#include <cstdio>

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
    // The editor is closing: a recording still running is saved, but nobody is left to tell.
    m_metrics.onRecordingFinished = nullptr;
    m_metrics.Shutdown(); // logs the open session and frees the GPU timer queries
    m_cropBoxRenderer.reset();
    m_gridRenderer.reset();
    m_renderer.reset();
    ImGui_ImplOpenGL3_Shutdown();
    ImGuiQtBackend::Shutdown();
    ImGui::DestroyContext();
    doneCurrent();
}

void Viewport::RenderFrameBlocking() {
    if (!m_glInitialized) {
        return;
    }
    repaint(); //Runs paintGL synchronously
    makeCurrent();
    glFinish(); //GL calls return early, wait so the GPU work is counted
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
    m_gridRenderer = std::make_unique<GridRenderer>();
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

    m_metrics.Init((AssetPaths::UserDataDir() + "/metrics").toStdString());

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
        [this](InputManager&, InputManager::INPUT_TYPE type) {
            Nudge(type, glm::vec3(1.0f, 0.0f, 0.0f));
        });
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::BACKSWARD,
        [this](InputManager&, InputManager::INPUT_TYPE type) {
            Nudge(type, glm::vec3(-1.0f, 0.0f, 0.0f));
        });
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::LEFT,
        [this](InputManager&, InputManager::INPUT_TYPE type) {
            Nudge(type, glm::vec3(0.0f, 0.0f, -1.0f));
        });
    m_input.AddCallBack(InputManager::STATE::NORMAL, InputManager::KEY_ACTIONS::RIGHT,
        [this](InputManager&, InputManager::INPUT_TYPE type) {
            Nudge(type, glm::vec3(0.0f, 0.0f, 1.0f));
        });
}

void Viewport::Nudge(InputManager::INPUT_TYPE type, const glm::vec3& direction) {
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
    //A gizmo drag owns the target, so nudges are ignored (DrawGizmo already closed any nudge when the drag began).
    //Presses are still counted: those keys are physically down, and their release must close a nudge started after the drag
    else if (m_gizmoWasUsing)
    {
        if (type == InputManager::PRESS) ++m_nudgeKeysDown;
        return;
    }

    //The target changed midburst nudges, finish old burst first
    //Box shown or hidden, another model selected
    //The key count is kept: those keys are still physically down, and their release must close the new burst
    if (m_nudgeActive && (m_nudgeIsCropBox != toCropBox || (!toCropBox && m_nudgeModel != model))) {
        FinishNudge();
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
        m_cropBox.transform = glm::translate(glm::mat4(1.0f), direction * SplatRenderer::kNudgeStep) * m_cropBox.transform;
        if (m_nudgeMovesContents) {
            m_renderer->SetRegionPreview(m_cropBox.transform * glm::inverse(m_nudgeBefore));
        }
    }
    else {
        m_renderer->NudgeSelectedModel(direction);
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
            FrameMetrics::ScopedCommit commitTimer(m_metrics);
            onCropBoxEdited(m_nudgeBefore, m_cropBox.transform);
        }
        return;
    }

    SplatModel* model = m_nudgeModel;
    m_nudgeModel = nullptr;
    //Only report if the model is still there and actually moved
    if (model && model == m_renderer->GetModel(m_renderer->GetSelectedModel())
        && model->GetTransform() != m_nudgeBefore && onTransformEdited) {
        FrameMetrics::ScopedCommit commitTimer(m_metrics);
        onTransformEdited(model, m_nudgeBefore, model->GetTransform());
    }
}

void Viewport::paintGL() {
    const QScreen* displayScreen = screen();
    m_metrics.BeginFrame(displayScreen ? displayScreen->refreshRate() : 60.0);

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
    m_metrics.BeginSection(FrameMetrics::Section::Scene);
    m_metrics.BeginGpuScene();
    //Grid first, so the models blend over it
    if (m_showGrid) m_gridRenderer->Draw(proj * view);
    m_renderer->Draw(view, proj, static_cast<float>(fbWidth), static_cast<float>(fbHeight), m_camera.getPosition());
    if (m_cropBox.active) {
        //Green when the gizmo moves the contents, otherwise orange for removing the inside and blue when keeping it
        glm::vec3 color = m_cropBox.removeInside ? glm::vec3(1.0f, 0.55f, 0.1f) : glm::vec3(0.2f, 0.7f, 1.0f);
        if (m_cropBox.moveContents) color = glm::vec3(0.3f, 1.0f, 0.4f);
        m_cropBoxRenderer->Draw(proj * view, m_cropBox.transform, color);
    }
    m_metrics.EndGpuScene();
    m_metrics.EndSection(FrameMetrics::Section::Scene);

    //Overlay time excludes any drag commit inside DrawGizmo, which is timed on its own
    m_metrics.BeginSection(FrameMetrics::Section::Overlay);
    ImGui_ImplOpenGL3_NewFrame();
    ImGuiQtBackend::NewFrame(*this, deltaTime);
    ImGui::NewFrame();
    if (m_showGrid) DrawGridLabels(view, proj);
    DrawGizmo(view, proj); //Draw Gizmos (Movement arrows, etc.)
    DrawToolButtons();
    DrawImGui(fps);
    DrawRecordingIndicator();
    ImGui::Render();
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
    m_metrics.EndSection(FrameMetrics::Section::Overlay);

    ReportMetricsActivity();
    m_metrics.EndFrame(m_renderer->TotalSplatCount(), m_renderer->ModelCount());

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

    //Swapping tool mid-drag ends the drag where it is. The gizmo stays inert until the mouse is released,
    //so carrying on with the held button (or swapping back) cannot move the target any further.
    if (m_gizmoWasUsing && toolMode != m_dragToolMode) {
        FinishGizmoDrag(model, editingBox);
        m_gizmoLocked = true;
    }
    if (m_gizmoLocked && !ImGui::GetIO().MouseDown[0]) {
        m_gizmoLocked = false;
    }

    if ((!editingBox && (!model || model->GetIsHidden())) || toolMode == InputManager::PAN) {
        //Nothing dragged, reset drag vars
        m_gizmoWasUsing = false;
        m_dragModel = nullptr;
        m_dragIsCropBox = false;
        m_dragMovesContents = false;
        m_dragBefore = glm::mat4(1.0f);
        //A nudge in progress owns the preview, FinishNudge clears it. Wiping it here every frame would
        //hide the carried splats moving while the arrow keys are held (nudging works in Pan mode too).
        if (!m_nudgeMovesContents) m_renderer->ClearRegionPreview();
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

    //A locked gizmo is still drawn but ignores the mouse
    ImGuizmo::Enable(!m_gizmoLocked);

    //ImGUIzmo method to edit the transform values
    //view, projection, operation type, local/world, transform value
    if (ImGuizmo::Manipulate(glm::value_ptr(view), glm::value_ptr(proj), operation,
                             space, glm::value_ptr(transform)))
    {
        //Apply transform value
        if (editingBox) m_cropBox.transform = transform;
        else model->SetTransform(transform);
    }

    //A whole drag is one undo step, remembers where it started and report it when it ends
    //The target is moved live during the drag, only the finished drag goes to the undo stack.
    const bool isUsing = ImGuizmo::IsUsing();
    if (isUsing && !m_gizmoWasUsing) {
        //A nudge still in progress is committed first, ending exactly where the drag begins (original), so no part
        //of the move is reported by both the nudge and the drag. The drag's first-frame change is put back after.
        if (m_nudgeActive) {
            const bool sameTarget = m_nudgeIsCropBox == editingBox;
            if (sameTarget) {
                if (editingBox) m_cropBox.transform = original;
                else model->SetTransform(original);
            }
            FinishNudge();
            if (sameTarget) {
                if (editingBox) m_cropBox.transform = transform;
                else model->SetTransform(transform);
            }
        }
        m_dragIsCropBox = editingBox;
        m_dragModel = editingBox ? nullptr : model;
        m_dragBefore = original;
        //Only a confirmed selection is carried, otherwise the drag just moves the box
        m_dragMovesContents = editingBox && m_cropBox.moveContents && m_renderer->HasSelection();
        m_dragToolMode = toolMode;
    }
    else if (!isUsing && m_gizmoWasUsing) {
        FinishGizmoDrag(model, editingBox);
    }
    m_gizmoWasUsing = isUsing;

    //While the box is dragged with a confirmed selection, draw the selected splats moving with it.
    //The splat data itself is only changed once the drag ends.
    if (isUsing && m_dragMovesContents) {
        m_renderer->SetRegionPreview(m_cropBox.transform * glm::inverse(m_dragBefore));
    }
}

void Viewport::FinishGizmoDrag(SplatModel* model, bool editingBox) {
    if (m_dragIsCropBox) {
        if (editingBox && m_cropBox.transform != m_dragBefore && onCropBoxEdited) {
            FrameMetrics::ScopedCommit commitTimer(m_metrics);
            onCropBoxEdited(m_dragBefore, m_cropBox.transform);
        }
    }
    else if (m_dragModel == model && model && model->GetTransform() != m_dragBefore && onTransformEdited) {
        FrameMetrics::ScopedCommit commitTimer(m_metrics);
        onTransformEdited(model, m_dragBefore, model->GetTransform());
    }
    m_dragModel = nullptr;
    m_dragIsCropBox = false;
    m_dragMovesContents = false;
    m_gizmoWasUsing = false;
    m_renderer->ClearRegionPreview(); //The callback above has baked the move into the splat data
}

void Viewport::ReportMetricsActivity() {
    using Activity = FrameMetrics::Activity;
    using Target = FrameMetrics::Target;
    const auto boxTarget = [](bool movesContents) {
        return movesContents ? Target::CropBoxContents : Target::CropBox;
    };

    if (m_gizmoWasUsing) {
        Activity activity = Activity::GizmoTranslate;
        if (m_dragToolMode == InputManager::ROTATE) activity = Activity::GizmoRotate;
        else if (m_dragToolMode == InputManager::SCALE) activity = Activity::GizmoScale;
        m_metrics.SetActivity(activity, m_dragIsCropBox ? boxTarget(m_dragMovesContents) : Target::Model);
    }
    else if (m_nudgeActive) {
        m_metrics.SetActivity(Activity::Nudge, m_nudgeIsCropBox ? boxTarget(m_nudgeMovesContents) : Target::Model);
    }
    else if (m_rightHeld) {
        m_metrics.SetActivity(Activity::CameraOrbit, Target::None);
    }
    else if (m_leftHeld) {
        m_metrics.SetActivity(Activity::CameraPan, Target::None);
    }
    else {
        m_metrics.SetActivity(Activity::Idle, Target::None);
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

void Viewport::DrawRecordingIndicator() {
    const FrameMetrics::RecordingLive rec = m_metrics.LiveRecording();
    if (!rec.active) return;

    ImGui::SetNextWindowPos(ImVec2(kOverlayPad, kOverlayPad), ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.55f);
    ImGui::Begin("Recording", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_AlwaysAutoResize |
                 ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoFocusOnAppearing |
                 ImGuiWindowFlags_NoNav | ImGuiWindowFlags_NoInputs);
    //Dot blinks once a second
    const bool dotOn = static_cast<long long>(rec.elapsedSec * 2.0) % 2 == 0;
    const auto total = static_cast<long long>(rec.elapsedSec);
    const float lineHeight = ImGui::GetTextLineHeight();
    const ImVec2 cursor = ImGui::GetCursorScreenPos();
    ImGui::GetWindowDrawList()->AddCircleFilled(ImVec2(cursor.x + lineHeight * 0.5f, cursor.y + lineHeight * 0.5f),
                                                lineHeight * 0.35f, IM_COL32(255, 70, 70, dotOn ? 255 : 90));
    ImGui::Dummy(ImVec2(lineHeight, lineHeight));
    ImGui::SameLine();
    ImGui::TextColored(ImVec4(1.0f, 0.45f, 0.45f, 1.0f), "REC %02lld:%02lld", total / 60, total % 60);
    ImGui::Text("Avg %.1f FPS | %llu drops", rec.avgFps, static_cast<unsigned long long>(rec.drops));
    ImGui::TextDisabled("Ctrl+Shift+R to stop");
    ImGui::End();
}

void Viewport::DrawGridLabels(const glm::mat4& view, const glm::mat4& proj) {
    const ImVec2 displaySize = ImGui::GetIO().DisplaySize;
    const glm::mat4 viewProj = proj * view;
    //Behind ImGui windows, so labels never cover the tool buttons or the stats overlay
    ImDrawList* drawList = ImGui::GetBackgroundDrawList();

    //World point -> widget pixels. False if it is behind the camera or off screen.
    const auto project = [&](const glm::vec3& world, ImVec2& out) {
        const glm::vec4 clip = viewProj * glm::vec4(world, 1.0f);
        if (clip.w <= 1e-4f) return false;
        const glm::vec3 ndc = glm::vec3(clip) / clip.w;
        if (ndc.x < -1.0f || ndc.x > 1.0f || ndc.y < -1.0f || ndc.y > 1.0f) return false;
        out = ImVec2((ndc.x * 0.5f + 0.5f) * displaySize.x, (0.5f - ndc.y * 0.5f) * displaySize.y);
        return true;
    };

    const ImU32 kXColor = IM_COL32(242, 90, 90, 230);
    const ImU32 kYColor = IM_COL32(90, 230, 100, 230);
    const ImU32 kZColor = IM_COL32(90, 145, 255, 230);

    //Unit numbers along the X and Z axes, none in the grid's faded edge. Walking out from the origin,
    //a number too close on screen to the last one drawn is skipped, so they never pile up near the
    //horizon or when zoomed out.
    constexpr float kMinLabelGap = 26.0f; //pixels
    const int lastLabel = static_cast<int>(GridRenderer::kFadeStart);
    char text[48];
    ImVec2 screen;
    ImVec2 origin;
    const bool originVisible = project(glm::vec3(0.0f), origin);
    if (originVisible) drawList->AddText(ImVec2(origin.x + 4.0f, origin.y + 2.0f), IM_COL32(220, 220, 220, 200), "0");
    const glm::vec3 labelAxes[2] = { glm::vec3(1.0f, 0.0f, 0.0f), glm::vec3(0.0f, 0.0f, 1.0f) };
    for (int a = 0; a < 2; ++a) {
        const ImU32 color = a == 0 ? kXColor : kZColor;
        for (int sign = -1; sign <= 1; sign += 2) {
            bool haveLast = originVisible;
            ImVec2 last = origin;
            for (int n = 1; n <= lastLabel; ++n) {
                const int value = sign * n;
                if (!project(labelAxes[a] * static_cast<float>(value), screen)) continue;
                const float dx = screen.x - last.x;
                const float dy = screen.y - last.y;
                if (haveLast && dx * dx + dy * dy < kMinLabelGap * kMinLabelGap) continue;
                std::snprintf(text, sizeof(text), "%d", value);
                drawList->AddText(ImVec2(screen.x + 3.0f, screen.y + 2.0f), color, text);
                last = screen;
                haveLast = true;
            }
        }
    }

    //XYZ direction marker in the bottom left corner, turning with the camera
    {
        const ImVec2 centre(42.0f, displaySize.y - 42.0f);
        constexpr float kLength = 26.0f;
        struct Axis { glm::vec3 dir; ImU32 color; const char* name; };
        const Axis axes[3] = {
            { glm::vec3(1.0f, 0.0f, 0.0f), kXColor, "X" },
            { glm::vec3(0.0f, 1.0f, 0.0f), kYColor, "Y" },
            { glm::vec3(0.0f, 0.0f, 1.0f), kZColor, "Z" },
        };
        drawList->AddCircleFilled(centre, kLength + 12.0f, IM_COL32(0, 0, 0, 90));
        for (const Axis& axis : axes) {
            const glm::vec3 d = glm::mat3(view) * axis.dir; //Camera space: x right, y up
            const ImVec2 tip(centre.x + d.x * kLength, centre.y - d.y * kLength);
            drawList->AddLine(centre, tip, axis.color, 2.0f);
            drawList->AddText(ImVec2(tip.x - 3.0f, tip.y - 7.0f), axis.color, axis.name);
        }
    }

    //Selected model: a line down to the grid and its coordinates, so its spot on the grid is easy to read
    SplatModel* model = m_renderer->GetModel(m_renderer->GetSelectedModel());
    if (model && !model->GetIsHidden()) {
        const glm::vec3 pos = ModelCentre(*model);
        const glm::vec3 foot(pos.x, 0.0f, pos.z);
        ImVec2 top;
        ImVec2 bottom;
        const bool topVisible = project(pos, top);
        const bool footVisible = project(foot, bottom);
        const ImU32 kMarker = IM_COL32(255, 210, 80, 220);
        if (topVisible && footVisible) drawList->AddLine(top, bottom, kMarker, 1.5f);
        if (footVisible) drawList->AddCircle(bottom, 4.0f, kMarker, 0, 1.5f);
        if (topVisible) {
            std::snprintf(text, sizeof(text), "(%.2f, %.2f, %.2f)", pos.x, pos.y, pos.z);
            drawList->AddText(ImVec2(top.x + 8.0f, top.y - 16.0f), kMarker, text);
        }
    }
}

glm::vec3 Viewport::ModelCentre(const SplatModel& model) {
    const std::vector<SplatVertex>& splats = model.splats();
    const glm::mat4& transform = model.GetTransform();
    if (splats.empty()) return glm::vec3(transform[3]);

    CentreCache& c = m_centreCache;
    const bool stale = c.model != &model || c.data != splats.data() || c.count != splats.size() ||
                       c.first != splats.front().position || c.last != splats.back().position;
    if (stale) {
        //Median per axis: unlike the bounds centre, a few stray splats far out don't move it
        std::vector<float> values(splats.size());
        const std::size_t mid = values.size() / 2;
        for (int axis = 0; axis < 3; ++axis) {
            for (std::size_t i = 0; i < splats.size(); ++i) values[i] = splats[i].position[axis];
            std::nth_element(values.begin(), values.begin() + static_cast<std::ptrdiff_t>(mid), values.end());
            c.localCentre[axis] = values[mid];
        }
        c.model = &model;
        c.data = splats.data();
        c.count = splats.size();
        c.first = splats.front().position;
        c.last = splats.back().position;
    }
    return glm::vec3(transform * glm::vec4(c.localCentre, 1.0f));
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

    //Frame metrics: last second averages, drops and a frame time graph
    const FrameMetrics::LiveStats& live = m_metrics.Live();
    ImGui::Text("1s avg %.1f FPS, worst %.1f ms", live.avgFps, live.worstFrameMs);
    if (live.avgGpuSceneMs >= 0.0f) ImGui::Text("Scene CPU %.2f ms | GPU %.2f ms", live.avgCpuSceneMs, live.avgGpuSceneMs);
    else ImGui::Text("Scene CPU %.2f ms | GPU n/a", live.avgCpuSceneMs);
    const ImVec4 dropColor = live.dropsLastSecond > 0 ? ImVec4(1.0f, 0.45f, 0.4f, 1.0f) : ImGui::GetStyleColorVec4(ImGuiCol_Text);
    ImGui::TextColored(dropColor, "Drops: %d last 1s, %llu total", live.dropsLastSecond,
                       static_cast<unsigned long long>(live.totalDrops));
    m_metrics.CopyIntervalHistory(m_frameTimePlot);
    //Scale so one refresh sits at a third of the height: a dropped frame clearly sticks up
    const float plotMax = std::max(live.expectedMs * 3.0f, 1.0f);
    char plotLabel[48];
    std::snprintf(plotLabel, sizeof(plotLabel), "frame ms (target %.1f)", live.expectedMs);
    ImGui::PlotLines("##frametimes", m_frameTimePlot.data(), static_cast<int>(m_frameTimePlot.size()), 0,
                     plotLabel, 0.0f, plotMax, ImVec2(220.0f, 48.0f));
    if (m_metrics.CurrentActivity() != FrameMetrics::Activity::Idle) {
        ImGui::Text("Measuring: %s", FrameMetrics::ActivityName(m_metrics.CurrentActivity()));
    }
    ImGui::Separator();
    ImGui::Text("Models: %zu / %d", m_renderer->ModelCount(), SplatRenderer::kMaxModels);
    ImGui::Text("Splats: %zu", m_renderer->TotalSplatCount());
    if (const SplatModel* selected = m_renderer->GetModel(m_renderer->GetSelectedModel())) {
        const glm::vec3 pos = ModelCentre(*selected);
        ImGui::Text("Centre: %.2f, %.2f, %.2f", pos.x, pos.y, pos.z);
    }
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
