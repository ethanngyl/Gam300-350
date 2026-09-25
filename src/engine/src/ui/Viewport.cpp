#include "ui/Viewport.h"

#include "ui/ImGuiQtBackend.h"
#include "splat/SplatLoader.h"
#include "splat/SplatRenderer.h"

#include <imgui.h>
#include <imgui_impl_opengl3.h>

#include <glm/glm.hpp>

#include <QKeyEvent>
#include <QMouseEvent>
#include <QWheelEvent>

#include <algorithm>
#include <iostream>
#include <stdexcept>

#ifndef ENGINE_ASSETS_DIR
#define ENGINE_ASSETS_DIR "."
#endif

namespace fs = std::filesystem;

namespace {
    // Qt reports a wheel notch as 120 units of angle delta.
    constexpr double kWheelNotch = 120.0;

    // Scans a directory (non-recursively) for .ply files and returns their full
    // paths, sorted by filename. Missing/unreadable directories yield an empty
    // list rather than throwing, so the browser degrades gracefully.
    std::vector<fs::path> ScanPlyFiles(const fs::path& dir) {
        std::vector<fs::path> results;
        std::error_code ec;
        if (!fs::is_directory(dir, ec)) {
            return results;
        }
        for (const auto& entry : fs::directory_iterator(dir, ec)) {
            if (ec) break;
            if (!entry.is_regular_file()) continue;
            auto ext = entry.path().extension().string();
            std::transform(ext.begin(), ext.end(), ext.begin(),
                           [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            if (ext == ".ply") {
                results.push_back(entry.path());
            }
        }
        std::sort(results.begin(), results.end(), [](const fs::path& a, const fs::path& b) {
            return a.filename().string() < b.filename().string();
        });
        return results;
    }
}

Viewport::Viewport(QWidget* parent)
    : QOpenGLWidget(parent)
    , m_splatDir(fs::path(ENGINE_ASSETS_DIR) / "samples") {
    setFocusPolicy(Qt::StrongFocus);
    setMouseTracking(true); // ImGui needs hover positions, not just drags
    m_plyFiles = ScanPlyFiles(m_splatDir);
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

// Loads a .ply through Clement's SplatLoader and hands it to the renderer.
// Returns false (and leaves the previous splats untouched) on empty/failed
// loads, so a bad file never blanks a good scene.
bool Viewport::LoadSplatFile(const fs::path& path) {
    auto splats = LoadSplatPly(path.string());
    if (splats.empty()) {
        std::cerr << "[Viewport] no splats loaded from '" << path.string() << "'" << std::endl;
        return false;
    }
    m_renderer->SetSplats(splats, path.filename().string());
    m_loadedPath = path.string();
    std::cout << "[Viewport] loaded " << splats.size() << " splats from '" << path.string() << "'" << std::endl;
    return true;
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

    glm::mat4 viewProj = m_camera.getProjection(aspect) * m_camera.getView();
    m_renderer->Draw(viewProj, static_cast<float>(fbHeight), m_camera.getPosition());

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
    if (m_showImGuiStats) {
        // Start clear of the .ply browser, which is pinned to the left edge.
        ImGui::SetNextWindowPos(ImVec2(310.0f, 10.0f), ImGuiCond_Once);
        ImGui::Begin("Engine Stats");
        ImGui::Text("FPS: %.1f", fps);
        ImGui::Text("Splats loaded: %zu", m_renderer->TotalSplatCount());
        ImGui::End();
    }

    // ------------------------------------------------------------------
    // .ply browser: lists the .ply files in m_splatDir. The user selects a
    // file, then clicks Load to display it. Snapped to the left edge and
    // stretched to the full window height. Uses SplatLoader's public API.
    // ------------------------------------------------------------------
    const float browserWidth = 300.0f;
    ImVec2 displaySize = ImGui::GetIO().DisplaySize;
    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f), ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(browserWidth, displaySize.y), ImGuiCond_Always);
    ImGui::Begin("PLY Files", nullptr,
                 ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse);

    ImGui::TextWrapped("Folder: %s", m_splatDir.string().c_str());
    if (ImGui::Button("Refresh")) {
        m_plyFiles = ScanPlyFiles(m_splatDir);
        m_selectedIndex = -1;
    }
    ImGui::SameLine();
    ImGui::Text("(%zu found)", m_plyFiles.size());
    ImGui::Separator();

    // Reserve space at the bottom for the Load button + separator.
    float totalAvail = ImGui::GetContentRegionAvail().y;
    float loadButtonHeight = ImGui::GetFrameHeightWithSpacing();
    float sectionHeight = (totalAvail - loadButtonHeight) * 0.45f;

    if (m_plyFiles.empty()) {
        ImGui::TextDisabled("No .ply files in this folder.");
    } else {
        ImGui::BeginChild("ply_list", ImVec2(0, sectionHeight), true);
        for (int i = 0; i < static_cast<int>(m_plyFiles.size()); ++i) {
            std::string name = m_plyFiles[i].filename().string();
            bool isLoaded = (m_plyFiles[i].string() == m_loadedPath);
            std::string label = isLoaded ? name + "  (loaded)" : name;
            if (ImGui::Selectable(label.c_str(), m_selectedIndex == i)) {
                m_selectedIndex = i;
            }
        }
        ImGui::EndChild();
    }

    ImGui::Separator();
    bool hasSelection = (m_selectedIndex >= 0 && m_selectedIndex < static_cast<int>(m_plyFiles.size()));
    if (!hasSelection) {
        ImGui::BeginDisabled();
    }
    if (ImGui::Button("Load", ImVec2(-1.0f, 0.0f)) && hasSelection) {
        LoadSplatFile(m_plyFiles[m_selectedIndex]);
    }
    if (!hasSelection) {
        ImGui::EndDisabled();
    }

    ImGui::Separator();
    ImGui::Text("Loaded Splats (%zu)", m_renderer->ModelCount());
    ImGui::BeginChild("loaded_models_list", ImVec2(0, sectionHeight), true);
    for (int i = 0; i < m_renderer->ModelCount(); ++i) {
        std::string label = m_renderer->GetModelName(i) + "  (" + std::to_string(m_renderer->GetSplatCount(i)) + " splats)";
        std::string id = label + "##model" + std::to_string(i);
        bool isSelected = (m_renderer->GetSelectedModel() == (i));
        if (ImGui::Selectable(id.c_str(), isSelected)) {
            m_renderer->SelectModel(i);
        }
    }
    ImGui::EndChild();

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
    if (event->key() == Qt::Key_Escape) {
        window()->close();
        return;
    }
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
