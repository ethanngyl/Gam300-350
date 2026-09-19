#include "Window.h"

#include <GL/glew.h>
#include <GLFW/glfw3.h>

#include <iostream>
#include <stdexcept>

namespace {
void glfwErrorCallback(int error, const char* description) {
    std::cerr << "[GLFW] error " << error << ": " << description << std::endl;
}
} // namespace

Window::Window(int width, int height, const std::string& title) {
    glfwSetErrorCallback(glfwErrorCallback);

    if (!glfwInit()) {
        throw std::runtime_error("Failed to initialize GLFW");
    }

    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
#ifdef __APPLE__
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GLFW_TRUE);
#endif

    m_window = glfwCreateWindow(width, height, title.c_str(), nullptr, nullptr);
    if (!m_window) {
        glfwTerminate();
        throw std::runtime_error("Failed to create GLFW window");
    }

    glfwMakeContextCurrent(m_window);
    glfwSwapInterval(1);

    glewExperimental = GL_TRUE;
    GLenum glewStatus = glewInit();
    if (glewStatus != GLEW_OK) {
        std::string message = reinterpret_cast<const char*>(glewGetErrorString(glewStatus));
        glfwDestroyWindow(m_window);
        glfwTerminate();
        throw std::runtime_error("Failed to initialize GLEW: " + message);
    }

    glfwSetWindowUserPointer(m_window, this);
    glfwSetFramebufferSizeCallback(m_window, framebufferSizeCallback);
    glfwSetCursorPosCallback(m_window, cursorPosCallback);
    glfwSetMouseButtonCallback(m_window, mouseButtonCallback);
    glfwSetScrollCallback(m_window, scrollCallback);
    glfwSetKeyCallback(m_window, keyCallback);

    glEnable(GL_DEPTH_TEST);
    glEnable(GL_PROGRAM_POINT_SIZE);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
}

Window::~Window() {
    if (m_window) {
        glfwDestroyWindow(m_window);
    }
    glfwTerminate();
}

bool Window::shouldClose() const {
    return glfwWindowShouldClose(m_window) != 0;
}

void Window::pollEvents() const {
    glfwPollEvents();
}

void Window::swapBuffers() const {
    glfwSwapBuffers(m_window);
}

void Window::getFramebufferSize(int& width, int& height) const {
    glfwGetFramebufferSize(m_window, &width, &height);
}

void Window::framebufferSizeCallback(GLFWwindow* w, int width, int height) {
    glViewport(0, 0, width, height);
    auto* self = static_cast<Window*>(glfwGetWindowUserPointer(w));
    if (self && self->onResize) {
        self->onResize(width, height);
    }
}

void Window::cursorPosCallback(GLFWwindow* w, double x, double y) {
    auto* self = static_cast<Window*>(glfwGetWindowUserPointer(w));
    if (!self) return;

    double dx = x - self->m_lastX;
    double dy = y - self->m_lastY;
    self->m_lastX = x;
    self->m_lastY = y;


    if (self->m_rotating && self->onMouseRotate) {
        self->onMouseRotate(dx, dy);
    }

    if (self->m_panning && self->onMousePan)
        self->onMousePan(dx, dy);
}

void Window::mouseButtonCallback(GLFWwindow* w, int button, int action, int /*mods*/) {
    auto* self = static_cast<Window*>(glfwGetWindowUserPointer(w));
    if (!self) return; 
    
    if (button == GLFW_MOUSE_BUTTON_RIGHT) {
        if (action == GLFW_PRESS) {
            self->m_rotating = true;
            glfwGetCursorPos(w, &self->m_lastX, &self->m_lastY);
        } else if (action == GLFW_RELEASE) {
            self->m_rotating = false;
        }
    }

    else if (button == GLFW_MOUSE_BUTTON_LEFT)
    {
        if (action == GLFW_PRESS) {
            self->m_panning = true;
            glfwGetCursorPos(w, &self->m_lastX, &self->m_lastY);
        }
        else if (action == GLFW_RELEASE) {
            self->m_panning = false;
        }
    }
}

void Window::scrollCallback(GLFWwindow* w, double /*xoffset*/, double yoffset) {
    auto* self = static_cast<Window*>(glfwGetWindowUserPointer(w));
    if (self && self->onScroll) {
        self->onScroll(yoffset);
    }
}

void Window::keyCallback(GLFWwindow* w, int key, int /*scancode*/, int action, int /*mods*/) {
    auto* self = static_cast<Window*>(glfwGetWindowUserPointer(w));
    if (self && self->onKey) {
        self->onKey(key, action);
    }
}
