Tech Team:
Ethan Ng (Technical Lead)
Xiong Yang (Gaussian/Colmap Champion)
Bryan Lim (Frontend Champion)
Gabriel Sebastian Putra (Backend Champion)
Clement Ang (Engine Champion)

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

To run (For Windows):
run-all.bat: Double clicking this will install all required packages and run both the web application as well as the engine
start.bat: Located in the packages folder, only starts the web-application
run.bat: Located in the engine folder, only starts the engine

To run (For macOS):
start.sh: Located in the packages folder, open a terminal in that folder and run "./start.sh" to start the web application
Note: The engine has no macOS support at the moment (Windows only), so there is no engine launcher for macOS. Compatibility to be researched and added in M2 due
to FMOD's multiple versions for different operating systems abd incompatibility with the fetch function for CMAKE.

To run (For Linux):
start-linux.sh: Located in the packages folder, open a terminal in that folder and run "./start-linux.sh" to start the web-application. The first run installs COLMAP via apt, so it will ask for your sudo password.
Note: The engine has no Linux support at the moment (Windows only), so there is no engine launcher for Linux. Compatibility to be researched and added in M2.
to FMOD's multiple versions for different operating systems abd incompatibility with the fetch function for CMAKE.

Testing the Website:

Navigation:
0. The web application can be accessed via http://localhost:5005 or the cloudflare link provided.
1. Left-click the top navigation bar buttons (Home, Library, Photo Editor) to cycle through tabs. Confirm each tab loads its own content and the active tab is visually highlighted.
2. On the Home tab, under Features, left-click each card and confirm it opens the right page:
   - Media Library → opens the Library tab (3D Models view)
   - Photo Editor → opens the Photo Editor tab
   - YouTube Extractor → opens the YouTube extractor page
   - Image Gallery → opens a list of past jobs, each showing a job ID, status (e.g. "cancelled," "done"), photo count, and a thumbnail grid of that job's uploaded photos

Scanning an object — camera capture:

3. From Home, click "New Generation" (or the "Drop images to upload" box in the sidebar) to open the capture screen.
4. Confirm the browser asks for camera permission, and once granted, the live camera feed appears in the preview box.
5. Manual mode (default):
   - Click "Capture photo" and confirm a thumbnail appears below, with a "Photo captured" confirmation message.
   - Repeat a few times and confirm the photo count updates correctly.
   - Click the × on a thumbnail and confirm it's removed from the batch.
6. Auto-capture mode:
   - Switch to "Auto capture."
   - Set the interval (e.g. 2s) and the max photo count from their dropdowns.
   - Click "Start auto-capture" and confirm photos are taken automatically on the chosen interval, with the running count shown (e.g. "12/50").
   - Click "Stop auto-capture" and confirm it actually stops.
   - Let it run to the max count and confirm it stops itself automatically once the cap is reached.
7. Click "Back to dashboard" mid-capture and confirm it returns you to the Home tab, and that the camera indicator (browser tab icon or OS camera indicator) turns off — this checks the camera is actually released, not just hidden.

Uploading existing photos instead of scanning live:

8. Re-open the capture screen. Click "Browse files" and select several images from your computer — confirm they're added to the batch with an "N photos uploaded" confirmation.
9. Drag a group of image files from your file explorer directly onto the upload box and drop them — confirm the box highlights while dragging, and the files are added the same way as the file picker.

Training a 3D model:

10. With fewer than the minimum required photos in the batch, confirm the "Train model" button is disabled and a message tells you how many more photos are needed.
11. Add enough photos to pass the minimum, then click "Train model."
12. Confirm the app moves to a processing screen showing live progress (phase name and percentage) as the backend runs COLMAP and trains the Gaussian splat.
13. Let it run to completion and confirm it automatically advances to the result screen once done.
14. On the result screen, confirm the rendered 3D model appears and can be orbited/zoomed with the mouse.
15. Test the result screen's buttons: "New scan" (starts over), "Download .ply" (downloads the file), and "Back to dashboard."
16. Failure case: try training with too few photos and confirm the processing screen shows a clear error message rather than hanging or crashing.
17. While a model is processing, click "Cancel" and confirm the job actually stops on the backend (not just visually — check it isn't still consuming GPU afterward if you can observe this).

18. On the YouTube extractor page, paste a valid YouTube video link and click "Extract frames."
19. Confirm it rejects invalid input: a non-YouTube URL, a playlist link, or a channel link should show an error message instead of submitting.
20. Adjust the fps field and confirm higher values pull more frames (slower) and lower values pull fewer (faster).
21. Confirm the status area updates live through each phase (extracting frames, detecting features, matching images, recovering camera poses, training, finalizing) with a progress bar.
22. Once finished, confirm a "Download result (.ply)" link appears and works.
23. Navigate away ("Back to dashboard") while a YouTube job is still running, then check the backend doesn't keep processing it unwatched.

Click sounds:

24. Confirm the top navigation buttons play a click sound.
25. Confirm the Home tab's feature cards play a click sound.
26. Confirm "Back to dashboard" button in the app plays a click sound.

Known limitations to note while testing (not bugs)

- Scene Builder tab is currently disabled — do not expect to find it in the navigation.
- COLMAP can fail on photo sets with poor overlap or low quality; this is an expected pipeline limitation, not a website bug. 


Engine Guide:

Loading .ply model:
1) Left click on .ply file within PLY FILES menu to select .ply model
2) Left Click load button
3) You can click the refresh button to show new .ply files added to the engine/assets/samples folder after you have added them there

Moving model:
1) Left click on model within Loaded Splats menu
2) Press WASD/Arrow Keys to move selected model around

Play/Stop Sounds:
1) Left Click on sound in Audio menu
2) Press Play Select
3) Press Stop All to stop all currently playing sounds

Loading Audio Files:
1) You can select which folder to load the audio files from under "Choose folder", the default folder path is under engine/assets/audio
2) You can load a specific audio file that is not in the selected folder with the "Play File Not Listed" button
