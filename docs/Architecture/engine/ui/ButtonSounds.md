# `ui/ButtonSounds.h` / `ButtonSounds.cpp`

An **application-wide event filter** that plays a short UI sound whenever the user left-clicks an enabled push button or tool button anywhere in the editor: the main window, docks, toolbars and dialogs. It has its own [AudioManager](../Manager/AudioManager.md), so it works independently of the Audio panel. `main()` creates it on the stack.

## Functions

### `ButtonSounds(QObject* parent = nullptr)`
1. Creates the `AudioManager`. If FMOD fails to start, it logs *"Button sounds disabled"* and does nothing else.
2. Builds the path `assets/audio/UI Hover New 1.wav`. If the file is missing, it logs a warning and stops.
3. Installs itself on `qApp` with `installEventFilter(this)`.
4. Starts a 50 ms `QTimer` that calls `m_audio->Update()`, the same interval the Audio panel uses, so FMOD is pumped and finished voices are freed.

### `~ButtonSounds()`
Defaulted, but defined in the `.cpp` so `std::unique_ptr<AudioManager>` sees the complete type.

### `bool eventFilter(QObject* watched, QEvent* event)`
On `MouseButtonPress` with the left button, if `watched` is a `QPushButton` or `QToolButton` and is enabled, it plays the click and logs any FMOD error. It always returns the base class's result, so **the event is never swallowed**.
