# `engine/src/main.cpp`

Entry point of the Codefine Engine desktop editor (Qt + OpenGL).

## `int main(int argc, char** argv)`

Runs once at program start, in this order:

1. **OpenGL surface format.** Builds a `QSurfaceFormat` asking for OpenGL **3.3 Core**, a 24-bit depth buffer, an 8-bit stencil buffer and vsync (`setSwapInterval(1)`). It is installed as the default format *before* the `QApplication` exists, because Qt reads the default when it creates every GL context. The renderer and ImGui's shaders are written as `#version 330 core`, so they need this.
2. **`QApplication`.** Sets the organisation (`CoDefine`) and application name (`Codefine Engine`). `QSettings` uses these to choose where window layout, recent files and preferences are saved.
3. **Headless mode.** If `IsHeadlessBuild()` finds `--build-model` on the command line, it returns `RunHeadlessBuild()`'s exit code straight away and never opens a window. See [pipeline/HeadlessBuild.md](pipeline/HeadlessBuild.md).
4. **Editor theme.** `EditorTheme::Apply(app)` sets the dark Fusion palette and stylesheet ([ui/EditorTheme.md](ui/EditorTheme.md)).
5. **Button sounds.** Creates a `ButtonSounds` on the stack. It is an application-wide event filter that plays a click on every button press, and it lives until `main` returns ([ui/ButtonSounds.md](ui/ButtonSounds.md)).
6. **Main window.** Creates and shows `MainWindow`, then calls `openFiles()` with every remaining argument. This is how "Open with…" and command-line `.ply` paths get imported.
7. **Event loop.** `app.exec()` runs until the window closes, and its return value is the process exit code.
