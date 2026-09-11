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

#include <iostream>
#include <string>

#ifndef ENGINE_ASSETS_DIR
#define ENGINE_ASSETS_DIR "."
#endif

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

    SplatRenderer renderer;
    std::string samplePath = std::string(ENGINE_ASSETS_DIR) + "/samples/sample_splat.ply";
    auto splats = LoadSplatPly(samplePath);
    renderer.setSplats(splats);

    if (splats.empty()) {
        std::cerr << "[main] no splats loaded from '" << samplePath << "'" << std::endl;
    } else {
        std::cout << "[main] loaded " << splats.size() << " splats from '" << samplePath << "'" << std::endl;
    }

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

        ImGui::Render();
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

        window.swapBuffers();
    }

    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();

    return 0;
}
