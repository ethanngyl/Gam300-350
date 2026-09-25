#include "ui/ImGuiQtBackend.h"

#include <imgui.h>

#include <QKeyEvent>
#include <QMouseEvent>
#include <QWheelEvent>
#include <QWidget>

namespace {
    // Qt reports a wheel notch as 120 units of angle delta.
    constexpr float kWheelNotch = 120.0f;

    ImGuiKey ToImGuiKey(int key) {
        if (key >= Qt::Key_A && key <= Qt::Key_Z) return static_cast<ImGuiKey>(ImGuiKey_A + (key - Qt::Key_A));
        if (key >= Qt::Key_0 && key <= Qt::Key_9) return static_cast<ImGuiKey>(ImGuiKey_0 + (key - Qt::Key_0));
        if (key >= Qt::Key_F1 && key <= Qt::Key_F12) return static_cast<ImGuiKey>(ImGuiKey_F1 + (key - Qt::Key_F1));

        switch (key) {
        case Qt::Key_Tab:
        case Qt::Key_Backtab:      return ImGuiKey_Tab;
        case Qt::Key_Left:         return ImGuiKey_LeftArrow;
        case Qt::Key_Right:        return ImGuiKey_RightArrow;
        case Qt::Key_Up:           return ImGuiKey_UpArrow;
        case Qt::Key_Down:         return ImGuiKey_DownArrow;
        case Qt::Key_PageUp:       return ImGuiKey_PageUp;
        case Qt::Key_PageDown:     return ImGuiKey_PageDown;
        case Qt::Key_Home:         return ImGuiKey_Home;
        case Qt::Key_End:          return ImGuiKey_End;
        case Qt::Key_Insert:       return ImGuiKey_Insert;
        case Qt::Key_Delete:       return ImGuiKey_Delete;
        case Qt::Key_Backspace:    return ImGuiKey_Backspace;
        case Qt::Key_Space:        return ImGuiKey_Space;
        case Qt::Key_Return:
        case Qt::Key_Enter:        return ImGuiKey_Enter;
        case Qt::Key_Escape:       return ImGuiKey_Escape;
        case Qt::Key_Control:      return ImGuiKey_LeftCtrl;
        case Qt::Key_Shift:        return ImGuiKey_LeftShift;
        case Qt::Key_Alt:          return ImGuiKey_LeftAlt;
        case Qt::Key_Meta:         return ImGuiKey_LeftSuper;
        case Qt::Key_Apostrophe:   return ImGuiKey_Apostrophe;
        case Qt::Key_Comma:        return ImGuiKey_Comma;
        case Qt::Key_Minus:        return ImGuiKey_Minus;
        case Qt::Key_Period:       return ImGuiKey_Period;
        case Qt::Key_Slash:        return ImGuiKey_Slash;
        case Qt::Key_Semicolon:    return ImGuiKey_Semicolon;
        case Qt::Key_Equal:        return ImGuiKey_Equal;
        case Qt::Key_BracketLeft:  return ImGuiKey_LeftBracket;
        case Qt::Key_Backslash:    return ImGuiKey_Backslash;
        case Qt::Key_BracketRight: return ImGuiKey_RightBracket;
        case Qt::Key_QuoteLeft:    return ImGuiKey_GraveAccent;
        default:                   return ImGuiKey_None;
        }
    }

    int ToImGuiMouseButton(Qt::MouseButton button) {
        switch (button) {
        case Qt::LeftButton:   return ImGuiMouseButton_Left;
        case Qt::RightButton:  return ImGuiMouseButton_Right;
        case Qt::MiddleButton: return ImGuiMouseButton_Middle;
        default:               return -1;
        }
    }

    void UpdateModifiers(Qt::KeyboardModifiers mods) {
        ImGuiIO& io = ImGui::GetIO();
        io.AddKeyEvent(ImGuiMod_Ctrl, mods.testFlag(Qt::ControlModifier));
        io.AddKeyEvent(ImGuiMod_Shift, mods.testFlag(Qt::ShiftModifier));
        io.AddKeyEvent(ImGuiMod_Alt, mods.testFlag(Qt::AltModifier));
        io.AddKeyEvent(ImGuiMod_Super, mods.testFlag(Qt::MetaModifier));
    }
}

void ImGuiQtBackend::Init() {
    ImGuiIO& io = ImGui::GetIO();
    io.BackendPlatformName = "imgui_impl_qt (Codefine)";
}

void ImGuiQtBackend::Shutdown() {
    ImGui::GetIO().BackendPlatformName = nullptr;
}

void ImGuiQtBackend::NewFrame(const QWidget& widget, float deltaTime) {
    ImGuiIO& io = ImGui::GetIO();
    const float dpr = static_cast<float>(widget.devicePixelRatioF());
    io.DisplaySize = ImVec2(static_cast<float>(widget.width()), static_cast<float>(widget.height()));
    io.DisplayFramebufferScale = ImVec2(dpr, dpr);
    io.DeltaTime = deltaTime > 0.0f ? deltaTime : 1.0f / 60.0f;
}

void ImGuiQtBackend::ProcessMouseMove(const QMouseEvent& event) {
    const QPointF pos = event.position();
    ImGui::GetIO().AddMousePosEvent(static_cast<float>(pos.x()), static_cast<float>(pos.y()));
}

void ImGuiQtBackend::ProcessMouseButton(const QMouseEvent& event, bool down) {
    ProcessMouseMove(event);
    const int button = ToImGuiMouseButton(event.button());
    if (button >= 0) {
        ImGui::GetIO().AddMouseButtonEvent(button, down);
    }
}

void ImGuiQtBackend::ProcessWheel(const QWheelEvent& event) {
    const QPoint delta = event.angleDelta();
    ImGui::GetIO().AddMouseWheelEvent(delta.x() / kWheelNotch, delta.y() / kWheelNotch);
}

void ImGuiQtBackend::ProcessKey(const QKeyEvent& event, bool down) {
    UpdateModifiers(event.modifiers());

    // ImGui runs its own key-repeat timer, so only real presses/releases count.
    if (!event.isAutoRepeat()) {
        const ImGuiKey key = ToImGuiKey(event.key());
        if (key != ImGuiKey_None) {
            ImGui::GetIO().AddKeyEvent(key, down);
        }
    }

    // Typed text, skipping control characters (Backspace, Enter, ...), which
    // arrive as key events above.
    const QString text = event.text();
    if (down && !text.isEmpty() && text.at(0).unicode() >= 0x20 && text.at(0).unicode() != 0x7F) {
        ImGui::GetIO().AddInputCharactersUTF8(text.toUtf8().constData());
    }
}

void ImGuiQtBackend::ProcessFocus(bool focused) {
    ImGui::GetIO().AddFocusEvent(focused);
}
