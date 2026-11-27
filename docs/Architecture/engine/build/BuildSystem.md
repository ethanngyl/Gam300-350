# Engine build system and scripts

These files are not C++ source, but they decide how the engine is configured, built, linted, packaged and run.

## `engine/CMakeLists.txt`
- Project `Codefine`, C++20. MSVC builds use `/MP` (parallel compile).
- `include(ImportDependencies)` then `importDependencies()`.
- Global definitions: `GLEW_STATIC`, `USE_CSD3151_AUTOMATION=0`, and **`ENGINE_ASSETS_DIR`**, the source-tree `assets/` path that [AssetPaths](../ui/AssetPaths.md) falls back to.
- Sources: `GLOB_RECURSE src/*.cpp|h|hpp` with `CONFIGURE_DEPENDS`, grouped in the IDE to mirror `src/`.
- MSVC warnings turned off: C4244, C4267, C4305, C4456, C4459, C26819. Otherwise `/W4` (MSVC) or `-Wall -Wextra` (GCC/Clang).
- Links: glm, GLEW (static), imgui (+ImGuizmo), stb, happly, FreeType, Lua, Qt6 Core/Gui/Widgets/OpenGL/OpenGLWidgets/Network, plus `opengl32` (Windows), the OpenGL framework (macOS) or GL/X11 (Linux). `AUTOMOC ON` for the `Q_OBJECT` classes.
- **Post-build (Windows):** copies the runtime DLLs, the `platforms/qwindows` plugin, the `tls/` Schannel plugin (so sign-in works over `https://`) next to the exe.
- `WIN32_EXECUTABLE TRUE` makes it a GUI app with no console, and `/ENTRY:mainCRTStartup` keeps the plain `int main()`. [HeadlessBuild](../pipeline/HeadlessBuild.md) attaches to the parent console when it needs one.
- **Install and packaging** (component `Codefine`, everything flat in one folder): the exe, the MSVC runtime (installed next to the app, so no redistributable is needed), and Qt through `qt_generate_deploy_app_script` (`--no-compiler-runtime`; CMP0087 set to NEW so the generator expression in the script name expands). Also `assets/samples` if `CODEFINE_PACKAGE_SAMPLES` is on (the default; about 180 MB). CPack makes a ZIP, plus an NSIS installer with a desktop shortcut when `makensis` is found. Package name *Genesis Alpha Build* 0.1.0.

## `engine/cmake/ImportDependencies.cmake`
One `macro(import_X)` per dependency. Each one is guarded by `if(NOT TARGET …)` and mostly uses `FetchContent`:

| Macro | Source | Pinned to |
|---|---|---|
| `import_glm` | g-truc/glm | 1.0.1 |
| `import_glew` | Perlmint/glew-cmake | commit `d06782b` (builds `libglew_static` from `glew.c`) |
| `import_imgui` | ocornut/imgui + CedricGuillemet/ImGuizmo | v1.89.9-docking / `105e4fd` |
| `import_stb` | nothings/stb | master |
| `import_freetype` | freetype | VER-2-14-1 |
| `import_lua` | lua/lua | v5.4.7 (`lua_static`) |
| `import_happly` | nmwsharp/happly | `983e8ed` |
| `import_qt` | a **prebuilt** SDK at `Library/Qt/6.8.3/msvc2022_64` (cache var `CODEFINE_QT_DIR`) | 6.8.3. It fails with a hint to run `run.bat` if Qt is missing. |

`function(importDependencies)` calls them in dependency order. The web build only calls `import_glm` and `import_happly`.

## `engine/run.bat`: build and run (Debug)
1. Notices a double-click launch (by checking `cmdcmdline`) so it can pause at the end.
2. **Qt on first run:** finds a real Python (skipping the Microsoft Store `WindowsApps` stub), creates a venv at `Library/Qt/.aqt-venv`, installs `aqtinstall`, and downloads Qt 6.8.3 `win64_msvc2022_64`. `QT_VERSION` must match `CODEFINE_QT_DIR`.
3. **CMake:** uses the one on PATH, or Visual Studio's bundled CMake found through `vswhere`.
4. Configures when `build\Codefine.sln` is **missing**. It does not check `CMakeCache.txt`, because an interrupted first configure leaves a cache with no project files. On failure it deletes the partial cache but keeps `_deps`.
5. Builds Debug, checks that the exe exists, and runs `start /b /wait "" build\Debug\Codefine.exe`. GUI-subsystem apps would otherwise return immediately and lose stdout. It reports a non-zero exit code.

## `engine/package.bat`
Needs `run.bat` to have configured `build\` already. Reconfigures, builds Release, runs `cmake --install … --component Codefine --prefix <abs>\dist` (Qt's deploy step rejects relative prefixes), then `cpack -C Release`. Output: `dist\Codefine.exe`, `build\Codefine-*-win64.zip`, and an `.exe` installer if NSIS is present.

## `engine/build-web.bat` / `build-web.sh`
Build the WebAssembly renderer ([web/package](../web/package.md)). They find a real Python, clone the **Emscripten SDK** into `Library/emsdk` on first run (`CF_EMSDK_VERSION = 4.0.10`, which must match the `emscripten/emsdk` image in `docker/Dockerfile`), install and activate it, then run `emcmake cmake -S web -B build-web` and `cmake --build`. The output is `web/package/dist/codefine-engine.js/.wasm`.

## `engine/lint-cpp.sh` and `engine/.clang-tidy`
- Lints **only `src/gfx` and `src/splat`**, the renderer code shared with the WebAssembly build. That code needs no Qt, so it can be checked on any machine (including CI).
- It reuses header-only dependencies from `build/_deps` if present, or shallow-fetches the pinned glm, GLEW and happly into `build-lint/_deps`.
- It first compiles a probe file, so a machine with no C++ standard library headers gets one clear message instead of an error for every file.
- Flags: `-std=c++20 -Isrc -isystem <deps> -DGLEW_STATIC -DGLEW_NO_GLU`. Third-party warnings are hidden through `-isystem`.
- `.clang-tidy`: `clang-analyzer-*` and `bugprone-*`, minus `easily-swappable-parameters`, `narrowing-conversions` and `implicit-widening-of-multiplication-result` (these mostly flag deliberate code). `WarningsAsErrors: '*'`, so any finding fails CI. `HeaderFilterRegex: '.*'` includes the engine's own headers.
