Pre-Requisities:
- Nodejs(Default Installation Settings): https://nodejs.org/en
- Visual Studio Community 22/26(With CMake and C++ packages): https://visualstudio.microsoft.com/downloads/
- Python 3.10 or later: https://www.python.org/downloads/
- Git: https://git-scm.com/download/win

Packages:

You do not need to install any of these by hand. The npm packages install when
you run packages/start.bat; the Python packages and Qt install when you run
engine/run.bat; the C++ libraries are fetched by CMake the first time the
engine is configured.

Web app + backend (npm -- packages/package.json):
- @mkkellogg/gaussian-splats-3d ^0.4.7
- express ^5.2.1
- file-type ^22.1.0
- marked ^18.0.14
- multer ^2.3.0
- react ^19.2.8
- react-dom ^19.2.8
- three ^0.186.0
  dev tools: @eslint/js, @types/react, @types/react-dom, @vitejs/plugin-react,
             eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh,
             globals, vite

Python (tools/requirements.txt):
- yt-dlp[default] >=2025.11.12
- opencv-python >=4.8.0
- aqtinstall (installed into a venv by engine/run.bat to download Qt)

Engine C++ libraries (fetched automatically by CMake / FetchContent):
- GLM 1.0.1
- GLEW (glew-cmake)
- FreeType 2.14.1
- Dear ImGui 1.89.9-docking
- stb (image loader, header-only)
- nlohmann/json 3.11.3
- Lua 5.4.7
- happly (.ply reader/writer, header-only)
- FMOD Studio API (Windows x64, bundled in engine/Library)
- Qt 6.8.3 (msvc2022_64, downloaded by engine/run.bat on first run)

External tools (downloaded automatically into tools/ on first run):
- COLMAP (structure-from-motion / multi-view stereo)
- Brush (Gaussian splatting trainer)
- cloudflared (public tunnel for sharing the web app)

To run:
run-all.bat: Double clicking this will install all required packages and run both the web application as well as the engine
start.bat: Located in the packages folder, only starts the web-application
run.bat: Located in the egine folder, only starts the engine

