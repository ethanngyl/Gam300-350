# 3D Object Scanner & Visualizer

> Team CoDefine - Real World Object Scanning to 3D Model Conversion

Capture/Takes in real-world object images and turns it into an interactable 3D model. The front-end scans an object either via a camera, uploaded files or a youtube video from multiple angles; the Python back-end will then reconstruct it with photogrammetry + Gaussian splatting pipeline; the custom renderer displays the final result.

---

## Overview

This project takes a set of photographs of a physical object and produces a 3D asset that can be viewed in a custom renderer. It is built as three loosely-coupled parts so the team can work on them in parallel:

- **Front-end (scanner):** a mobile app that captures overlapping photos of an object from many angles. Early development targets small objects on a rotating stand (spinning-photo-booth style) for controlled, repeatable captures.
- **Back-end (reconstruction pipeline):** a Python service that runs the captured images through COLMAP (structure-from-motion + multi-view stereo) to recover camera poses and a point cloud, then through Gaussian Splatting, and exports a renderable 3D asset.
- **Engine (renderer/visualizer):** a custom 3D renderer that loads and displays the reconstructed asset.

The end goal of the project is to have as many additional features/solve current problems that similar existing applications are having in the market.

## Tech stack

| Part | Stack |
| --- | --- |
| Scanner (front-end) | Mobile app _(framework TBD)_ |
| Reconstruction | Python, COLMAP _(external — see below)_, Gaussian Splatting |
| API / orchestration | Python _(e.g. FastAPI)_ |
| Renderer (engine) | Custom 3D renderer _(target TBD — native C++/OpenGL or web)_ |

## Prerequisites/How to Set up

Application Installations:
- Nodejs(Default Installation Settings): https://nodejs.org/en
- Visual Studio Community 22/26(With CMake and C++ packages): https://visualstudio.microsoft.com/downloads/
- Python 3.10 or later: https://www.python.org/downloads/
- Git: https://git-scm.com/download/win

## How to Run
- Windows: Double click start.bat in the packages folder, any missing packages will be automatically installed by the script
- macOS (Apple Silicon): Open the terminal in the packages folder and enter "./start.sh"
- Ubuntu / Linux (x86_64): Open a terminal in the packages folder and enter "./start-linux.sh" (the first run installs COLMAP via apt, so it will ask for your sudo password)

## Run with Docker
Runs the web app + reconstruction backend (COLMAP, Brush, YouTube extractor) in a container, no Node/Python/tool installs needed. Requires Docker Desktop.
- Open a terminal in the repo root
- Start: `docker compose up -d --build`, then open http://localhost:5005
- Logs: `docker compose logs -f app`
- Public link for teammates: `docker compose --profile tunnel up -d`, the trycloudflare.com URL is printed in `docker compose logs tunnel`
- Stop: `docker compose down` (uploaded jobs and results are kept in a Docker volume)
- NVIDIA GPU: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build`
- Without an NVIDIA GPU (e.g. AMD cards) everything runs on the CPU and Brush training is very slow. Lower `TRAIN_ITERS` in docker-compose.yml for quick tests
- The engine's desktop editor is not included (build it natively as below), but its renderer is: the image compiles it to WebAssembly for the web app's viewer

## How to Run Engine
- Go to the engine folder
- Double click run.bat to generate the build folder
- Click on the icon to reveal hidden folders
- Under the build folder double click on Codefine.sln
- Once you are in the solution, right click on codefine and set it as the start up project
- Start the debugger
- .ply files can be added into the engine/assets folder

## How to Package the Engine as a Desktop App
Builds a Release copy that runs on any Windows PC, with no Visual Studio, Qt or repo needed.
- Run engine/run.bat once first (downloads Qt and sets up the build folder)
- Double click engine/package.bat
- engine/dist/Codefine.exe is the ready-to-run app; engine/build/Codefine-0.1.0-win64.zip is the same folder zipped for sharing
- With NSIS installed (https://nsis.sourceforge.io), package.bat also produces a Codefine-0.1.0-win64.exe installer with Start Menu and desktop shortcuts
- The sample splats add ~180 MB; configure with `-DCODEFINE_PACKAGE_SAMPLES=OFF` to leave them out

## Engine renderer in the web app
The web app's 3D viewer can render with the engine's own splat renderer (`engine/src/splat`, `engine/src/gfx`) compiled to WebAssembly, instead of the Three.js viewer.
- The start scripts (`start.bat`, `start.sh`, `start-linux.sh`) build it automatically. The first run downloads the Emscripten SDK into `engine/Library/emsdk` (a few hundred MB); later runs only rebuild what changed. Output goes to `packages/src/web-app/public/engine/`
- To build it on its own: double click `engine/build-web.bat` (Windows), or run `./engine/build-web.sh` (macOS / Linux, needs `git`, `python3` and `cmake`: `brew install cmake` / `sudo apt install cmake git python3`)
- Re-run it after changing anything in `engine/src/splat`, `engine/src/gfx` or `engine/web`. Docker builds it automatically
- In the viewer, switch between **Engine renderer** and **Three.js renderer** (bottom left), and between Gaussian / Point cloud (bottom right). If the engine hasn't been built, or the browser has no WebGL2, the Three.js viewer is used
- Controls: drag to orbit, right-drag or Shift-drag to pan, scroll or pinch to zoom, double-click to reset the view
- Web-specific code: `engine/web/` (entry point + CMake), and the `CODEFINE_GLES` blocks in `SplatRenderer.cpp` / `Shader.cpp` (WebGL2 has no geometry shaders, so Gaussian mode draws instanced quads there)

## How to use Engine
The engine opens as a dockable editor: **Scene** (left), **Inspector** (right), and **Assets / Console / Audio** tabs (bottom). Panels can be dragged, tabbed, floated or hidden from the Window menu; the layout is remembered between runs (Window > Reset Layout restores the default).
- Import a splat: double-click a .ply in the **Assets** panel, use File > Import Splat (Ctrl+O), drag .ply files onto the window, or pass them on the command line (`Codefine.exe model.ply`). Large files load in the background.
- Select a model in the **Scene** panel; edit its name and position in the **Inspector**. F2 renames, Delete removes it from the scene (the file is untouched).
- Camera: right-drag to orbit, left-drag to pan, scroll to zoom, Home to recenter. With the viewport focused, WASD/Arrow keys nudge the selected model and Esc deselects.
- Switch between Point Cloud and Gaussian Splat rendering from the toolbar (Ctrl+1 / Ctrl+2).
- Engine output (`std::cout`/`std::cerr` and Qt messages) appears in the **Console** panel. Help > Controls lists every shortcut.

## Current Features
- Basic Frontend, allows for navigation to image capturing/uploading page
- Capable of generating a downloadable .ply file from uploaded images
- Youtube frame image extractor, images per frame can be modified

## Current Issues
-  The model used for training is taxing and requires a strong GPU, the model training is reliant on a CUDA GPU meaning the host system will always need to remain online, other options are being explored at the moment.
-  The youtube frame extractor can extract images but the quality and kind of images captured might not be compatible with colmap's requirements.

## Team

Team Codefine GAM300-350

| Name | Role |
| --- | --- |
| Ethan Ng | Tech/Team Lead |
| Gerard | Design |
| Clement Ang | Engine Champion |
| Xiong Yang | Gaussian/Colmap |
| Bryan Lim | Frontend |
| Gabriel | Backend |