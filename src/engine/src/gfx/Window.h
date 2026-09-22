#pragma once

#include <functional>
#include <string>

struct GLFWwindow;

class Window {
public:
    Window(int width, int height, const std::string& title);
    ~Window();

    Window(const Window&) = delete;
    Window& operator=(const Window&) = delete;

    bool shouldClose() const;
    void pollEvents() const;
    void swapBuffers() const;
    void getFramebufferSize(int& width, int& height) const;

    GLFWwindow* handle() const { return m_window; }

    // Set by the owner (main.cpp) to receive input events.
    std::function<void(double dx, double dy)> onMouseRotate;
    std::function<void(double dx, double dy)> onMousePan;
    std::function<void(double dy)> onScroll;
    std::function<void(int width, int height)> onResize;
    std::function<void(int key, int action)> onKey;

private:
    static void framebufferSizeCallback(GLFWwindow* w, int width, int height);
    static void cursorPosCallback(GLFWwindow* w, double x, double y);
    static void mouseButtonCallback(GLFWwindow* w, int button, int action, int mods);
    static void scrollCallback(GLFWwindow* w, double xoffset, double yoffset);
    static void keyCallback(GLFWwindow* w, int key, int scancode, int action, int mods);

    GLFWwindow* m_window = nullptr;
    bool m_rotating = false;
    bool m_panning = false;
    double m_lastX = 0.0;
    double m_lastY = 0.0;
};
