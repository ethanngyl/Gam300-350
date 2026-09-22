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

    int getDX() const {
        return m_lastDX;
    };
    int getDY() const {
        return m_lastDY;
    };

    int getScrollY() const{
        return m_lastScrollY;
    }

    GLFWwindow* handle() const { return m_window; }

    // Set by the owner (main.cpp) to receive input events.
    std::function<void(int width, int height)> onResize;
    std::function<void(int key, int action)> onKey;

    std::function<void(int key, int inputType, double dx, double dy)> onMouseClick;
    std::function<void(double dy)> onScroll;


private:
    static void framebufferSizeCallback(GLFWwindow* w, int width, int height);
    static void cursorPosCallback(GLFWwindow* w, double x, double y);
    static void mouseButtonCallback(GLFWwindow* w, int button, int action, int mods);
    static void scrollCallback(GLFWwindow* w, double xoffset, double yoffset);
    static void keyCallback(GLFWwindow* w, int key, int scancode, int action, int mods);

    GLFWwindow* m_window = nullptr;

    bool m_leftClickHeld = false;
    bool m_rightClickHeld = false;

    double m_lastX = 0.0;
    double m_lastY = 0.0;
    double m_lastDX = 0.0;
    double m_lastDY = 0.0;
    double m_lastScrollY = 0.0;
};
