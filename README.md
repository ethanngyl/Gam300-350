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
- Docker files live in the `docker/` folder. Open a terminal in the repo root
- Start: `docker compose -f docker/docker-compose.yml up -d --build`, then open http://localhost:5005
- Logs: `docker compose -f docker/docker-compose.yml logs -f app`
- Public link for teammates: `docker compose -f docker/docker-compose.yml --profile tunnel up -d`, the trycloudflare.com URL is printed in `docker compose -f docker/docker-compose.yml logs tunnel`
- Stop: `docker compose -f docker/docker-compose.yml down` (uploaded jobs and results are kept in a Docker volume)
- NVIDIA GPU: `docker compose -f docker/docker-compose.yml -f docker/docker-compose.gpu.yml up -d --build`
- Without an NVIDIA GPU (e.g. AMD cards) everything runs on the CPU and Brush training is very slow. Lower `TRAIN_ITERS` in docker/docker-compose.yml for quick tests
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
The engine opens as a dockable editor: **Scene** (left), **Inspector** (right), and **Assets / My Models / Console / Audio** tabs (bottom). Panels can be dragged, tabbed, floated or hidden from the Window menu; the layout is remembered between runs (Window > Reset Layout restores the default).
- Import a splat: double-click a .ply in the **Assets** panel, use File > Import Splat (Ctrl+O), drag .ply files onto the window, or pass them on the command line (`Codefine.exe model.ply`). Large files load in the background.
- Select a model in the **Scene** panel; edit its name and position in the **Inspector**. F2 renames, Delete removes it from the scene (the file is untouched).
- Camera: right-drag to orbit, left-drag to pan, scroll to zoom, Home to recenter. With the viewport focused, WASD/Arrow keys nudge the selected model and Esc deselects.
- Switch between Point Cloud and Gaussian Splat rendering from the toolbar (Ctrl+1 / Ctrl+2).
- Export: File > Export (Ctrl+E), or right-click a model in the **Scene** panel, converts the selected model (or the whole scene) to another format. Trimming and position changes are included.
  - .glb (glTF), .obj, .ply: points, or a mesh with one coloured ellipsoid per splat, for Blender, Unity, Unreal, MeshLab, etc.
  - .stl: mesh without colour, for 3D printing / CAD
  - Gaussian splat .ply or .splat: stays a splat, for Codefine and other splat viewers (view-dependent colour is not kept)
  - Mesh exports get large: raise "Min opacity" to drop faint haze splats, and use Low mesh detail for big scans
- Engine output (`std::cout`/`std::cerr` and Qt messages) appears in the **Console** panel. Help > Controls lists every shortcut.

## Signing in to the Engine
The engine uses the same accounts as the web app, so models made through the web app can be opened in the desktop editor.
- Start the backend first (`start.bat` / `start.sh` / Docker), then in the engine go to Account > Sign In, or click Sign In in the **My Models** tab
- Server is the web app's address, `http://localhost:5005` by default. Point it at the machine that processed the models: with `AUTH_MODE=client`, accounts are on the VM but each machine keeps its own models
- Signing in to another machine over plain `http://` sends your password unencrypted, so the engine asks before doing it. Use an `https://` address where there is one
- **My Models** lists your models; double-click a finished one (or select it and click Import) to download it and load it into the scene. Unchanged models load from a local copy instead of downloading again
- A normal account only sees the models it uploaded. An **admin** account sees every user's models, including old ones with no recorded owner. The backend enforces this, not the engine
- "Remember me" keeps you signed in for 7 days. Only the session is saved (in the engine's settings), never the password
- Sign Out deletes that account's downloaded models from the PC (`%APPDATA%/CoDefine/Codefine Engine/remote-models`), so the next person can't open them
- Local files are not affected: the **Assets** panel and File > Import still open any .ply on disk. Note the backend also copies every finished model into `engine/assets/samples`, so on the machine running the backend, the Assets panel shows every user's models
- Code: `engine/src/net/BackendClient` (sign-in, model list, downloads), `engine/src/ui/LoginDialog` and `engine/src/ui/RemoteModelsPanel`. The engine signs in with the same session cookie as the browser, so it needs no engine-specific backend routes

## Current Features
- Basic Frontend, allows for navigation to image capturing/uploading page
- Capable of generating a downloadable .ply file from uploaded images
- Youtube frame image extractor, images per frame can be modified
- Accounts shared by the web app and the desktop engine: users only see, rename and delete their own models; admins can access all of them

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