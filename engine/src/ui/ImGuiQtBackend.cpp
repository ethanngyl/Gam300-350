/*!************************************************************************
\file ImGuiQtBackend.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 01-10-2026
\brief
Implements the minimal ImGui platform backend for Qt: maps Qt mouse, wheel,
keyboard and focus events onto ImGui's IO and manages per-frame timing, so
the widget can then consult io.WantCaptureMouse / io.WantCaptureKeyboard to
decide whether the engine should also see each event.
**************************************************************************/
#include "ui/ImGuiQtBackend.h"

#include <imgui.h>

#include <QKeyEvent>
#include <QMouseEvent>
#include <QWheelEvent>
#include <QWidget>

namespace {
    // Qt reports a wheel notch as 120 units of angle delta.
    constexpr float kWheelNotch = 120.0f;

    // Translates a Qt key code into ImGui's key enum. Returns ImGuiKey_None for
    // keys ImGui doesn't need, so the caller can ignore them.
    ImGuiKey ToImGuiKey(int key) {
        // Letters, digits and F1-F12 are contiguous ranges in both enums, so
        // they map by offset instead of one case per key.
        if (key >= Qt::Key_A && key <= Qt::Key_Z) return static_cast<ImGuiKey>(ImGuiKey_A + (key - Qt::Key_A));
        if (key >= Qt::Key_0 && key <= Qt::Key_9) return static_cast<ImGuiKey>(ImGuiKey_0 + (key - Qt::Key_0));
        if (key >= Qt::Key_F1 && key <= Qt::Key_F12) return static_cast<ImGuiKey>(ImGuiKey_F1 + (key - Qt::Key_F1));

        switch (key) {
        // Qt reports Shift+Tab as Key_Backtab; ImGui wants Tab plus the Shift
        // modifier, which UpdateModifiers() supplies.
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
        // Qt doesn't tell left and right modifier keys apart, so both map to
        // the left-hand ImGui key.
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

    // Translates a Qt mouse button into ImGui's button index (0 = left,
    // 1 = right, 2 = middle). Returns -1 for buttons ImGui doesn't track.
    int ToImGuiMouseButton(Qt::MouseButton button) {
        switch (button) {
        case Qt::LeftButton:   return ImGuiMouseButton_Left;
        case Qt::RightButton:  return ImGuiMouseButton_Right;
        case Qt::MiddleButton: return ImGuiMouseButton_Middle;
        default:               return -1;
        }
    }

    // ImGui reads Ctrl/Shift/Alt/Super from separate ImGuiMod_* keys (used for
    // shortcuts like Ctrl+C), so their state is resent with every key event.
    void UpdateModifiers(Qt::KeyboardModifiers mods) {
        ImGuiIO& io = ImGui::GetIO();
        io.AddKeyEvent(ImGuiMod_Ctrl, mods.testFlag(Qt::ControlModifier));
        io.AddKeyEvent(ImGuiMod_Shift, mods.testFlag(Qt::ShiftModifier));
        io.AddKeyEvent(ImGuiMod_Alt, mods.testFlag(Qt::AltModifier));
        io.AddKeyEvent(ImGuiMod_Super, mods.testFlag(Qt::MetaModifier));
    }
}

// Registers this backend with ImGui. The name only shows up in debug tools
// such as ImGui::ShowAboutWindow().
void ImGuiQtBackend::Init() {
    ImGuiIO& io = ImGui::GetIO();
    io.BackendPlatformName = "imgui_impl_qt (Codefine)";
}

// Unregisters the backend. Nothing else to free: no state is kept here.
void ImGuiQtBackend::Shutdown() {
    ImGui::GetIO().BackendPlatformName = nullptr;
}

// Tells ImGui how big the widget is and how much time has passed since the
// last frame.
void ImGuiQtBackend::NewFrame(const QWidget& widget, float deltaTime) {
    ImGuiIO& io = ImGui::GetIO();
    // On high-DPI screens (e.g. 150% Windows scaling) the widget size is in
    // logical pixels while the OpenGL framebuffer is in physical pixels. ImGui
    // lays out in logical pixels and the renderer multiplies by this scale,
    // so the UI stays sharp and correctly sized.
    const float dpr = static_cast<float>(widget.devicePixelRatioF());
    io.DisplaySize = ImVec2(static_cast<float>(widget.width()), static_cast<float>(widget.height()));
    io.DisplayFramebufferScale = ImVec2(dpr, dpr);
    // ImGui asserts that DeltaTime > 0, which the first frame can't
    // guarantee, so fall back to a nominal 60 fps.
    io.DeltaTime = deltaTime > 0.0f ? deltaTime : 1.0f / 60.0f;
}

// The event position is already relative to the widget and in logical
// pixels, matching io.DisplaySize, so it is passed through unchanged.
void ImGuiQtBackend::ProcessMouseMove(const QMouseEvent& event) {
    const QPointF pos = event.position();
    ImGui::GetIO().AddMousePosEvent(static_cast<float>(pos.x()), static_cast<float>(pos.y()));
}

// `down` is true for a press, false for a release.
void ImGuiQtBackend::ProcessMouseButton(const QMouseEvent& event, bool down) {
    // Update the position first, so the click lands where the cursor is even
    // if no move event arrived beforehand.
    ProcessMouseMove(event);
    const int button = ToImGuiMouseButton(event.button());
    if (button >= 0) {
        ImGui::GetIO().AddMouseButtonEvent(button, down);
    }
}

// ImGui expects wheel amounts in notches (1.0 = one click), so Qt's angle
// delta is divided by 120. Touchpads send smaller fractional amounts.
void ImGuiQtBackend::ProcessWheel(const QWheelEvent& event) {
    const QPoint delta = event.angleDelta();
    ImGui::GetIO().AddMouseWheelEvent(delta.x() / kWheelNotch, delta.y() / kWheelNotch);
}

// A Qt key event carries two things ImGui handles separately: the physical
// key (for navigation and shortcuts) and the text it produced (for typing
// into input boxes). Both are forwarded below.
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
    // arrive as key events above. Characters below 0x20 and 0x7F (DEL) are
    // the non-printable ones. Unlike the key events, this part also runs on
    // auto-repeat, so holding a letter keeps typing it.
    const QString text = event.text();
    if (down && !text.isEmpty() && text.at(0).unicode() >= 0x20 && text.at(0).unicode() != 0x7F) {
        ImGui::GetIO().AddInputCharactersUTF8(text.toUtf8().constData());
    }
}

// When the widget loses focus, ImGui releases any keys it thinks are held,
// so a key released in another window doesn't stay stuck down.
void ImGuiQtBackend::ProcessFocus(bool focused) {
    ImGui::GetIO().AddFocusEvent(focused);
}
