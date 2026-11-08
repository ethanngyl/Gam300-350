Tech Team:
Ethan Ng (Technical Lead)
Xiong Yang (Gaussian/Colmap Champion)
Bryan Lim (Frontend Champion)
Gabriel Sebastian Putra (Backend Champion)
Clement Ang (Engine Champion)

Pre-Requisites:
- Node.js (default installation settings): https://nodejs.org/en
- Visual Studio Community 2022/2026 (with the CMake and C++ workloads): https://visualstudio.microsoft.com/downloads/
- Python 3.10 or later: https://www.python.org/downloads/
- Git: https://git-scm.com/download/win
- Optional: NSIS (https://nsis.sourceforge.io), only needed if you want engine/package.bat to also build a Windows installer.

Packages:

You do not need to install any of these by hand. The npm and Python packages
install when you run packages/start.bat; Qt installs when you run
engine/run.bat; the C++ libraries are fetched by CMake the first time the
engine is configured; the Emscripten SDK downloads the first time
engine/build-web.bat runs (start.bat calls it for you).

Web app + backend (npm -- packages/package.json):
- @codefine/splat-renderer (the engine's renderer compiled to WebAssembly; local package in engine/web/package, built by engine/build-web.bat)
- @mkkellogg/gaussian-splats-3d ^0.4.7
- ajv 8.17.1 (checks data against the JSON schemas in packages/src/backend/schemas)
- express ^5.2.1
- file-type ^22.1.0
- multer ^2.3.0
- react ^19.2.8
- react-dom ^19.2.8
- three ^0.186.0
  dev tools: @apidevtools/swagger-parser (OpenAPI checks in the tests),
             @eslint/js, @types/react, @types/react-dom, @vitejs/plugin-react,
             eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh,
             globals, vite

Python (tools/requirements.txt, installed by packages/start.bat):
- opencv-python >=4.8.0 (Frame Extractor)
- rembg >=2.0.60 and pillow >=10.0.0 (optional "Remove background"; the segmentation model downloads on first use)
- onnxruntime: start.bat installs onnxruntime-gpu on NVIDIA GPUs and plain onnxruntime elsewhere
- aqtinstall (installed into a separate venv by engine/run.bat to download Qt)

Engine C++ libraries (fetched automatically by CMake / FetchContent):
- GLM 1.0.1
- GLEW (glew-cmake)
- FreeType 2.14.1
- Dear ImGui 1.89.9-docking
- ImGuizmo (move / rotate / scale gizmos in the viewport)
- stb (image loader, header-only)
- Lua 5.4.7
- happly (.ply reader/writer, header-only)
- FMOD Studio API (Windows x64, bundled in engine/Library)
- Qt 6.8.3 (msvc2022_64: Core, Gui, Widgets, OpenGL, OpenGLWidgets, Network; downloaded by engine/run.bat on first run)

External tools (downloaded automatically on first run):
- COLMAP (structure-from-motion / multi-view stereo) -- into tools/. The CPU-only build is fetched on machines without an NVIDIA GPU.
- Brush 1.0.0 (Gaussian splatting trainer) -- built from source into tools/ (about 10-15 minutes, one time).
- cloudflared (public tunnel for sharing the web app) -- into tools/.
- Emscripten SDK (compiles the engine renderer to WebAssembly for the web app's viewer) -- into engine/Library/emsdk, a few hundred MB, one time.

Architecture and API:
docs/architecture.md: how the frontend, backend layers and database fit together, and every API endpoint.
docs/data-schema.md: the database tables (diagram), naming / date / unit rules, and every saved file format with its version.
docs/api-changelog.md: API versions (/api/v1 and the old, deprecated unversioned paths), every API change and every database migration.
packages/src/backend/openapi.yaml: the API reference (OpenAPI 3.1) with an example request and response for every endpoint; open it in https://editor.swagger.io. Also served at /api/v1/openapi.yaml.
Tests: "npm test" (in packages) runs the backend tests (auth, the OpenAPI contract, no secrets in the repo, migrations, scenes, API versions, adapters, performance, 30 users at once). CI runs them on every push.
Lint (all blocking in CI): "npm run lint" in packages (ESLint), "ruff check --config ruff.toml tools" (Python), and engine/lint-cpp.sh (clang-tidy on the engine renderer; pip install clang-tidy==22.1.8).
Performance: "npm run perf" (in packages) measures API p50 / p95 against the budget in README.md ("Performance budget"), on a temporary server; exits 1 if a route is over budget. The latest measured numbers (engine, web viewer on desktop and phone, API, deployed VM) are in README.md under "Latest measurements".
Load: "npm run load" (in packages) runs LOAD_USERS users (default 100) through a whole visit at the same time, LOAD_ROUNDS times (default 3), and reports failures and p95 under load. "npm test" also runs a 30-user concurrency test (concurrency.test.js).
Performance: every API request is timed, and the website reports how long it took to load. Signed in as an admin, GET /api/v1/metrics/performance?window=1h (or 24h, 7d) shows p50 / p95 / p99 per route and for page loads on that machine. Kept 7 days (PERF_KEEP_DAYS).
Database changes are numbered migrations in packages/src/backend/migrations; the backend applies them at startup. "npm run migrate -- --db <file>" (in packages) migrates any database file, including a new empty one.
packages/src/backend/.env.example: every backend setting (ports, server addresses, keys). Copy it to .env; never commit .env.
packages/api-tests: a curl test client that calls the API on its own (api-smoke.bat on Windows, api-smoke.sh elsewhere). See its README.md.
features.txt: a full list of the current features of the web app and engine.

To run (For Windows):
run-all.bat: Double-click to install all required packages and run both the web application and the engine (each opens in its own window).
packages/start.bat: Only starts the web application. It installs npm packages, builds the engine's WebAssembly renderer (engine/build-web.bat),
  builds the web app, downloads COLMAP / Brush / cloudflared if missing, installs the Python packages, then starts the backend and a
  Cloudflare tunnel. Keep both windows it opens running while the site is in use.
engine/run.bat: Only starts the engine (downloads Qt on the first run, then configures, builds and launches it).

To run (Docker, any OS with Docker Desktop):
docker compose -f docker/docker-compose.yml up -d --build (from the repo root), then open http://localhost:5005. Runs the web app and
  the reconstruction backend with no Node / Python / tool installs. Add -f docker/docker-compose.gpu.yml on NVIDIA GPUs; without one,
  training runs on the CPU and is very slow. The desktop engine is not included. Full commands (logs, tunnel, stop) are in README.md.

Deployed VM:
The VM has no GPU, so model training is not available there. Sign-in, accounts and viewing models work; to build models, run the
backend on a machine with an NVIDIA GPU (start.bat, or Docker with the GPU file above).

Other scripts (Windows):
packages/start-metrics.bat: Starts the metrics dashboard (job timings, iterations, splat counts, hardware/GPU use) on http://localhost:5010.
engine/build-web.bat: Rebuilds just the engine's WebAssembly renderer used by the web app's 3D viewer. If it fails, the viewer falls back to the three.js renderer.
engine/package.bat: Makes a portable build of the engine, plus a Windows installer if NSIS is installed.
clean.bat: Deep clean -- removes all build artifacts so the next run rebuilds from scratch.

To run (For macOS):
packages/start.sh: Open a terminal in the packages folder and run "./start.sh" to start the web application.
Note: The desktop engine has no macOS support at the moment (Windows only), so there is no engine launcher for macOS. FMOD ships a
different build per operating system and the current CMake fetch setup only handles the Windows one. The engine's WebAssembly
renderer (engine/build-web.sh) still builds, so the web app's 3D viewer works on macOS.

To run (For Linux):
packages/start-linux.sh: Open a terminal in the packages folder and run "./start-linux.sh" to start the web application. The first run
installs COLMAP via apt, so it will ask for your sudo password. Building the WebAssembly renderer needs cmake, git and python3
(sudo apt install cmake git python3).
Note: The desktop engine has no Linux support at the moment (Windows only), for the same FMOD reason as macOS.


Testing the Website:

Signing in:
0. The web application can be accessed via http://localhost:5005 or the Cloudflare link printed by start.bat.
1. On the login screen, create an account (email and password) or sign in. "Continue as guest" also works, but guests cannot send
   feedback or manage an account. "Continue with Google" and "Forgot password" are not implemented yet and only show a message.
2. On first sign-in a short walkthrough of the dock plays. It can be replayed later from the account menu or the Account page.

Navigation (the dock):
3. Every page has a floating dock at the bottom of the screen. From left to right: "New model", "Add photos", the pages (Home, Media
   Library, Photo Editor, Scene Builder, Frame Extractor, Model Viewer, Feedback), then your avatar.
4. Hover over an icon and confirm its label slides out. Click each page and confirm it opens and its icon is highlighted.
5. On a wide window (1160px or more), use the "Show Tab Labels" / "Hide Tab Labels" switch at the top-right to keep every label showing.
6. With a mouse, move the pointer away from the dock and confirm it slides mostly out of view after about 3 seconds, and comes back
   when the pointer reaches the bottom of the screen.
7. Click your avatar and confirm the menu opens upwards with: Account, mute / unmute sound, replay walkthrough, sign out.
8. Phone / narrow window (760px or less): the dock becomes a full-width bar that is always visible.

Home:
9. With no models yet, Home shows a "Create your first 3D model" card. Once you have some, it shows a "Recent" section with
   "Your files" and "Generated models" tabs, and "View all".

Scanning an object -- camera capture:
10. Click "New model" in the dock to open the capture screen.
11. Confirm the browser asks for camera permission and, once granted, the live camera feed appears in the preview box.
12. Manual mode (default):
    - Click "Capture photo" (or press Space) and confirm a thumbnail appears below.
    - Repeat a few times and confirm the photo count updates.
    - Click the x on a thumbnail and confirm it is removed from the batch.
13. Auto-capture mode:
    - Switch to "Auto capture".
    - Set the interval (0.5s to 5s) and the max photo count.
    - Click "Start auto-capture" (or press Space) and confirm photos are taken on the chosen interval, with a running count (e.g. "12/50").
    - Click "Stop auto-capture" and confirm it stops.
    - Let it run to the max count and confirm it stops by itself.
14. Each photo is checked in the background for blur, bad exposure and near-duplicates; problem photos are outlined.
15. Click "Back to dashboard" mid-capture and confirm you return to Home and the camera indicator (browser tab or OS) turns off --
    this checks the camera is actually released, not just hidden.

Adding existing photos instead of scanning live:
16. Click "Add photos" in the dock and pick several images -- confirm they open on the capture screen as a batch.
17. On the capture screen, "Browse files" adds more, and dragging images from your file explorer onto the upload box adds them too
    (the box highlights while dragging). Photos can also be added from your Media Library.

Photo Editor:
18. On the capture screen, click "Review photos first" to open the batch in the Photo Editor.
19. Confirm the same photo checks are shown, and each photo can be kept or left out.
20. Try the edits: auto fix, brightness, contrast, warmth, tint, auto colour, pick a neutral spot, sharpen, crop. They apply to the
    whole batch, or to one photo on desktop.
21. Confirm it warns about strong settings, lost highlight or shadow detail, and large or mixed crops.
22. "Use original photos" ignores all edits (the originals are never changed). "Back to camera" returns the photos to the capture screen.

Building a 3D model:

Model detail (training iterations):
The "Model detail" slider (on the capture screen, the Photo Editor and the Frame Extractor) sets how many training iterations Brush runs.
Fewer iterations are faster; more give a sharper, more detailed model.
- Fast: 5,000 iterations
- Normal: 7,000 iterations (the website's default)
- Detailed: 10,000 iterations
These presets (and the minimum of 8 photos) are reference data in packages/src/backend/catalog/catalog.json, read by the website
through GET /api/v1/catalog.
The server accepts 1,000 to 30,000 iterations and clamps anything outside that range. When no value is sent (requests not made from
the website), the server uses TRAIN_ITERS from packages/src/backend/.env, which defaults to 10,000.

"Remove background" (capture screen, Photo Editor, Frame Extractor) cuts the object out of each photo before reconstruction.

23. With no photos in the batch, confirm "Use this batch" and "Review photos first" are disabled.
24. Add photos taken all the way around the object, then click "Use this batch (N photos)".
25. Confirm the processing screen shows the live step, iteration counter, progress bar, elapsed time and a step tracker while the
    backend runs COLMAP and trains the Gaussian splat.
26. When it finishes, confirm you are asked to name the model, then the model page opens.
27. On the model page, confirm the 3D model renders and can be orbited / zoomed, and try: the pencil (rename), full screen,
    "Download .ply", "Add to scene", "Open in Media Library", Rename and Delete.
28. Failure case: try building with a poor photo set and confirm the processing screen explains the failure with tips instead of hanging.
29. While a model is processing, click "Cancel" (or leave the screen any other way) and confirm the job stops on the backend, not just
    visually -- check it is no longer using the GPU if you can.

Frame Extractor:
30. Open Frame Extractor from the dock. Drop or browse for videos or animated GIFs (MP4, MOV, WEBM, MKV, AVI, MPEG, GIF; up to 10
    files, 2 GB each) and confirm they are listed.
31. Confirm invalid input is rejected: a photo or text file shows an error, and a text file renamed to .mp4 is refused by the server.
32. Adjust the frames-per-second field: higher values pull more frames (slower), lower values fewer (faster). At least 8 frames are needed.
33. Click "Process media" and confirm the processing screen shows the upload first, then each phase (extracting frames, detecting
    features, matching images, recovering camera poses, training, finalizing), with Cancel available throughout.
34. When it finishes, confirm the model opens on the model page and "Download .ply" works.
35. After a failed or cancelled build, confirm the Frame Extractor form comes back filled in with your previous files and settings.

Media Library:
36. "3D Models": a searchable, sortable grid (Newest, Oldest, Name, Last edited) with Ready / Processing status. Covers show the object
    cut out of one of its photos.
37. Right-click a model to rename or delete it; deleting also removes its photo batch.
38. "Photo Library": photo batches grouped by job, with search and sort; click a photo to download it.

Model Viewer:
39. Pick any finished model, or open a local .ply file, and confirm it opens in the viewer.
40. The viewer uses the engine's WebAssembly renderer by default and falls back to (or can be switched to) the three.js renderer.
    Confirm the choice is remembered after a reload.

Scene Builder:
41. Add models from the library (or "Add to scene" on a model page) and confirm they all show in one 3D viewport.
42. Select a model and move, rotate and scale it with the gizmo; dragging elsewhere orbits the camera. W/A/S/D slide it along the
    ground relative to the camera (hold Shift for bigger steps).
43. Try drop to floor, duplicate, delete, undo / redo, then save the scene and reopen it.
44. Desktop: the outliner (with hide), the inspector (exact values), snapping, background colour and keyboard shortcuts.
    Phone: a bottom toolbar and bottom sheets, with a limit on how many models a scene holds.

Account and feedback:
45. Account page: profile card and profile photo, change password, sound effects on / off and volume, usage stats (models, photos,
    failed builds, queue), replay walkthrough, log out.
46. Admins see every user's models; normal users see only their own.
47. Feedback page (signed in): pick a type, write feedback and send it; confirm the "Thanks for your feedback" message.

Sounds:
48. Confirm dock buttons, Home and model-page buttons play a tap / back sound; the camera plays a shutter sound; a finished build plays
    a success sound and a failed one an error sound.
49. Mute from the account menu or turn sound off on the Account page, and confirm the sounds stop.

Known limitations to note while testing (not bugs):
- "Continue with Google" and "Forgot password" only show a message.
- Scene Builder: clean-up, render mode, reset view, screenshot and an exact drop to floor are waiting on scene functions in the
  WebAssembly engine. Scenes are saved only in this browser (localStorage): the backend has scene routes (/api/v1/scenes),
  but the web app doesn't use them yet (SCENES_API_READY in SceneStorage.js).
- COLMAP can fail on photo sets with poor overlap or low quality; this is an expected pipeline limitation, not a website bug.


Engine Guide (Genesis Alpha Build, Windows only):

Help > Controls (F1) inside the engine lists every shortcut.

Viewport camera:
- Right mouse drag: orbit
- Left mouse drag: pan (when not grabbing a gizmo)
- Mouse wheel: zoom
- Home: recenter camera (View > Recenter Camera)
- View > Render Mode: Point Cloud (Ctrl+1) or Gaussian Splat (Ctrl+2); also on the toolbar
- View > Stats Overlay: toggles the stats overlay

Loading .ply models:
1) File > Import Splat... (Ctrl+O), or drag and drop .ply files onto the window, or File > Open Recent.
2) Assets panel: lists the .ply files in engine/assets/samples (finished web-app builds are copied there automatically). Filter the
   list and load from it; it updates by itself when files are added to the folder.
3) My Models panel: after Account > Sign In, lists the models you made in the web app (admins see everyone's) and downloads them
   to a per-user cache.
4) File > Trim Splats on Import: optionally cleans models up as they load (see Trimming).
Files load on a background thread, so the editor stays responsive.

Selecting and editing models:
1) Left-click a model in the Scene panel to select it. Esc (viewport focused) or Edit > Deselect clears the selection.
2) With the viewport focused, Q / W / E / R switch between the Pan, Translate, Rotate and Scale tools. Drag the gizmo in the viewport to
   move, rotate or scale the selected model.
3) Arrow keys nudge the selected model: Up / Down along X, Left / Right along Z.
4) Inspector panel: name, splat count, exact position, rotation and scale, and per-model trim values.
5) Edit menu: Rename (F2), Delete (Delete), Hide/Show Model (Ctrl+H), Reset Position.
6) Undo (Ctrl+Z) / Redo (Ctrl+Y) cover moves, rotations, scales and inspector edits.

Crop box:
1) Edit > Add Crop Box (Ctrl+B) adds a box around the selected model.
2) Move / scale the box with the gizmo (nudges move the box while it is active).
3) Choose whether it removes what is outside or inside (Edit > Crop Box Removes Inside), or toggle Crop Box Moves Contents (Ctrl+Shift+B).
4) Press Enter (viewport focused) or Edit > Apply / Confirm Crop Box to apply it.

Trimming:
- Removes low-opacity splats, crops a percentage off each end of every axis, and drops splats in sparse regions.
- Edit > Trim Settings... sets the global defaults; the Inspector sets values for each model.

Exporting:
1) File > Export... (Ctrl+E).
2) Choose the selected model or the whole scene, and a format: Gaussian .ply, .splat, point-cloud .ply, .obj, .glb or .stl.
3) For mesh formats, choose how splats become geometry; a size estimate is shown, and your last choices are remembered.

Account:
1) Open the My Models tab on the bottom row and click Sign In (or Account > Sign In...).
2) Change the server address to the server you want, if needed (http://localhost:5005 by default).
3) Enter your account and password from the web app. "Remember me on this PC" keeps you signed in for 7 days.
4) Account > Sign Out signs out and deletes that account's downloaded models from the PC.

Play/Stop sounds (Audio panel):
1) Left-click one or more sounds in the list (Ctrl / Shift to select several), then press "Play Selected", or double-click a single sound.
   Several sounds can play at once; the live count shows next to the buttons.
2) Press "Stop All" to stop all currently playing sounds.
3) "Choose Folder..." picks which folder to list audio files from; the default is engine/assets/audio.
4) "Play File..." plays a specific audio file that is not in the listed folder.
5) Clicking any button in the editor (including toolbar buttons and dialog buttons) plays a short UI click sound.

Panels and layout:
- Scene, Inspector, Assets, My Models, Console and Audio are dockable panels. Open or close them from the Window menu, drag them to
  rearrange, and use Window > Reset Layout to restore the default. The layout is saved between runs.
- Console panel: shows engine output and Qt logs, colour-coded.
