# `ui/ImGuiQtBackend.h` / `ImGuiQtBackend.cpp`

A minimal **ImGui platform backend for Qt**, the Qt counterpart of `imgui_impl_glfw`. Drawing still goes through `imgui_impl_opengl3`. The [Viewport](Viewport.md) passes its Qt events here, then checks `io.WantCaptureMouse` and `io.WantCaptureKeyboard` to decide whether the engine should also handle each event.

## Public functions (`namespace ImGuiQtBackend`)

### `void Init()` / `void Shutdown()`
Set or clear `io.BackendPlatformName = "imgui_impl_qt (Codefine)"`. No other state is kept.

### `void NewFrame(const QWidget& widget, float deltaTime)`
Call it before `ImGui::NewFrame()`. It sets `DisplaySize` to the widget's **logical** size and `DisplayFramebufferScale` to `devicePixelRatioF()`, so the UI stays sharp and correctly sized on high-DPI screens. It sets `DeltaTime`, falling back to 1/60 because ImGui asserts that the value is greater than 0, which the first frame cannot guarantee.

### `void ProcessMouseMove(const QMouseEvent&)`
Passes `event.position()` straight through (it is already widget-relative and in logical pixels).

### `void ProcessMouseButton(const QMouseEvent&, bool down)`
Updates the position first, so the click lands where the cursor is even if no move event came first. It then sends the left, right or middle button. Other buttons are ignored.

### `void ProcessWheel(const QWheelEvent&)`
Divides `angleDelta` by 120, Qt's units per wheel notch. Touchpads send smaller fractional values.

### `void ProcessKey(const QKeyEvent&, bool down)`
- Resends the Ctrl, Shift, Alt and Super modifier state (`UpdateModifiers`) on every key event.
- Sends the physical key, but **not on auto-repeat**, because ImGui runs its own repeat timer.
- Sends typed text through `AddInputCharactersUTF8` on press, skipping control characters (below 0x20, and 0x7F). This part **does** run on auto-repeat, so holding a letter keeps typing it.

### `void ProcessFocus(bool focused)`
`AddFocusEvent`. When focus is lost, ImGui releases every key it thinks is held, so a key released in another window does not stay stuck down.

## Internal helpers

- **`ToImGuiKey(int qtKey)`**: letters, digits and F1–F12 are mapped by offset, because they are contiguous ranges in both enums. Navigation, editing and punctuation keys are mapped with a `switch`. `Key_Backtab` maps to Tab, with Shift supplied by the modifier state. Qt does not tell left and right modifier keys apart, so both map to the left-hand ImGui key. Anything else returns `ImGuiKey_None`.
- **`ToImGuiMouseButton(Qt::MouseButton)`**: Left, Right and Middle map to 0, 1 and 2; anything else returns −1.
- **`UpdateModifiers(mods)`**: sends `ImGuiMod_Ctrl`, `Shift`, `Alt` and `Super` key events.
