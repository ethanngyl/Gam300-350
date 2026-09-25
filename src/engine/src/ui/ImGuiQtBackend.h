#pragma once

class QWidget;
class QMouseEvent;
class QWheelEvent;
class QKeyEvent;

// Minimal ImGui platform backend for Qt (the Qt counterpart of
// imgui_impl_glfw). Rendering still goes through imgui_impl_opengl3.
// The widget forwards its Qt events here; afterwards it checks
// io.WantCaptureMouse / io.WantCaptureKeyboard to decide whether the engine
// should also see the event.
namespace ImGuiQtBackend {
    void Init();
    void Shutdown();

    // Call before ImGui::NewFrame() with the widget ImGui draws into.
    void NewFrame(const QWidget& widget, float deltaTime);

    void ProcessMouseMove(const QMouseEvent& event);
    void ProcessMouseButton(const QMouseEvent& event, bool down);
    void ProcessWheel(const QWheelEvent& event);
    void ProcessKey(const QKeyEvent& event, bool down);
    void ProcessFocus(bool focused);
}
