#include "gfx/Window.h"
#include "gfx/Camera.h"
#include "splat/SplatLoader.h"
#include "splat/SplatRenderer.h"

#include <GL/glew.h>
#include <GLFW/glfw3.h>

#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl3.h>

#include <glm/glm.hpp>

#include <algorithm>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

#ifndef ENGINE_ASSETS_DIR
#define ENGINE_ASSETS_DIR "."
#endif

namespace fs = std::filesystem;

// Scans a directory (non-recursively) for .ply files and returns their full
// paths, sorted by filename. Missing/unreadable directories yield an empty
// list rather than throwing, so the browser degrades gracefully.
static std::vector<fs::path> ScanPlyFiles(const fs::path& dir) {
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

int main() {
    Window window(1280, 720, "Codefine - Engine Foundation (M1)");
    Camera camera;

    window.onMouseDrag = [&camera](double dx, double dy) {
        camera.processDrag(dx, dy);
    };
    window.onScroll = [&camera](double dy) {
        camera.processScroll(dy);
    };
    window.onKey = [&window](int key, int action) {
        if (key == GLFW_KEY_ESCAPE && action == GLFW_PRESS) {
            glfwSetWindowShouldClose(window.handle(), GLFW_TRUE);
        }
    };

    // ImGui setup -- foundation for the sandbox UI in later milestones.
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGui::StyleColorsDark();
    ImGui_ImplGlfw_InitForOpenGL(window.handle(), true);
    ImGui_ImplOpenGL3_Init("#version 330");


    //Render 1 frame so not a white screen with not responding
    {
        glClearColor(0.05f, 0.05f, 0.08f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

        window.swapBuffers();
        window.pollEvents(); //Loading takes awhile, stops "Not Responding" from appearing
    }


    SplatRenderer renderer;

    // Directory the .ply browser lists from, and the file currently displayed.
    fs::path splatDir = fs::path(ENGINE_ASSETS_DIR) / "samples";
    std::string loadedPath;

    // Loads a .ply through Clement's SplatLoader and hands it to the renderer.
    // Returns false (and leaves the previous splats untouched) on empty/failed
    // loads, so a bad file never blanks a good scene.
    auto loadSplatFile = [&](const fs::path& path) -> bool {
        auto splats = LoadSplatPly(path.string());
        if (splats.empty()) {
            std::cerr << "[main] no splats loaded from '" << path.string() << "'" << std::endl;
            return false;
        }
        renderer.setSplats(splats);
        loadedPath = path.string();
        std::cout << "[main] loaded " << splats.size() << " splats from '" << path.string() << "'" << std::endl;
        return true;
    };

    std::vector<fs::path> plyFiles = ScanPlyFiles(splatDir);
    int selectedIndex = -1; // file highlighted in the browser; -1 = none

    // Nothing is loaded by default -- the user picks a file and clicks Load.

    double lastTime = glfwGetTime();

    while (!window.shouldClose()) {
        window.pollEvents();

        double currentTime = glfwGetTime();
        float deltaTime = static_cast<float>(currentTime - lastTime);
        lastTime = currentTime;
        float fps = deltaTime > 0.0f ? 1.0f / deltaTime : 0.0f;

        int width = 0, height = 0;
        window.getFramebufferSize(width, height);
        float aspect = height > 0 ? static_cast<float>(width) / static_cast<float>(height) : 1.0f;

        glClearColor(0.05f, 0.05f, 0.08f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

        glm::mat4 viewProj = camera.getProjection(aspect) * camera.getView();
        renderer.draw(viewProj, static_cast<float>(height));

        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();

        ImGui::Begin("Engine Stats");
        ImGui::Text("FPS: %.1f", fps);
        ImGui::Text("Splats loaded: %zu", renderer.splatCount());
        ImGui::End();

        // ------------------------------------------------------------------
        // .ply browser: lists the .ply files in splatDir. The user selects a
        // file, then clicks Load to display it. Snapped to the left edge and
        // stretched to the full window height. Uses SplatLoader's public API.
        // ------------------------------------------------------------------
        const float browserWidth = 300.0f;
        ImVec2 displaySize = ImGui::GetIO().DisplaySize;
        ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(browserWidth, displaySize.y), ImGuiCond_Always);
        ImGui::Begin("PLY Files", nullptr,
                     ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse);

        ImGui::TextWrapped("Folder: %s", splatDir.string().c_str());
        if (ImGui::Button("Refresh")) {
            plyFiles = ScanPlyFiles(splatDir);
            selectedIndex = -1;
        }
        ImGui::SameLine();
        ImGui::Text("(%zu found)", plyFiles.size());
        ImGui::Separator();

        // Reserve space at the bottom for the Load button + separator.
        float footerHeight = ImGui::GetFrameHeightWithSpacing() + ImGui::GetStyle().ItemSpacing.y;
        if (plyFiles.empty()) {
            ImGui::TextDisabled("No .ply files in this folder.");
        } else {
            ImGui::BeginChild("ply_list", ImVec2(0, -footerHeight), true);
            for (int i = 0; i < static_cast<int>(plyFiles.size()); ++i) {
                std::string name = plyFiles[i].filename().string();
                bool isLoaded = (plyFiles[i].string() == loadedPath);
                std::string label = isLoaded ? name + "  (loaded)" : name;
                if (ImGui::Selectable(label.c_str(), selectedIndex == i)) {
                    selectedIndex = i;
                }
            }
            ImGui::EndChild();
        }

        ImGui::Separator();
        bool hasSelection = (selectedIndex >= 0 && selectedIndex < static_cast<int>(plyFiles.size()));
        if (!hasSelection) {
            ImGui::BeginDisabled();
        }
        if (ImGui::Button("Load", ImVec2(-1.0f, 0.0f)) && hasSelection) {
            loadSplatFile(plyFiles[selectedIndex]);
        }
        if (!hasSelection) {
            ImGui::EndDisabled();
        }
        ImGui::End();

        ImGui::Render();
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

        window.swapBuffers();
    }

    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();

    return 0;
}
