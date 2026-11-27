# Web app: 3D viewers

---

## `SplatViewer.jsx`
Shows a finished Gaussian splat `.ply`. **By default it uses the Codefine engine's own renderer compiled to WebAssembly** ([EngineSplatViewer](#enginesplatviewerjsx)). If that is unavailable, or the user switches to it, it uses **`@mkkellogg/gaussian-splats-3d`** (three.js based: WebGL rendering, depth sorting and orbit controls).

- `RENDERER_PREF_KEY = 'genesis.splatRenderer'`. **`readRendererPref()` / `writeRendererPref(r)`** remember the choice per browser in `localStorage`, wrapped in `try`.
- **`ThreeSplatViewer({ url, isEmbedded })`** *(private)*:
  1. `readCameraUp(url)` reads the `Vertical axis` comment from the header (only 4 KB), so any scene renders upright.
  2. Creates `new GaussianSplats3D.Viewer({ rootElement, cameraUp, initialCameraPosition: [-3, 1, 5], initialCameraLookAt: [0, 0, 0], sharedMemoryForWorkers: false })`. Shared memory is off so no COOP/COEP headers are needed in development.
  3. `addSplatScene(url, { format: Ply, splatAlphaRemovalThreshold: 5, showLoadingUI: true })`. The format is given explicitly because blob URLs have no extension to infer it from. Then `start()`.
  4. **Clean-up** when the URL changes or the component unmounts: `stop()`, then `dispose()`. `dispose()` always tries to remove its root element from `<body>` and throws here (the root is this component's div), so that error is caught and ignored.
- **`SplatViewer({ url, isEmbedded })`** (default export): checks `isEngineAvailable()`, then shows the engine or the three.js viewer, with a **toggle** to switch. If the engine reports that it is unavailable, it falls back to three.js. With `isEmbedded`, it draws inside its parent, which must be `position: relative` (as the model page's viewer card is), and the toggle sits at the top left. Otherwise it covers the whole page.

---

## `EngineSplatViewer.jsx`
Shows a Gaussian splat `.ply` using **the Codefine engine's own renderer**, the same C++ as the desktop editor, compiled to WebAssembly and installed as `@codefine/splat-renderer` ([engine/web/package](../../engine/web/package.md)). The engine draws into a WebGL2 canvas. **This component owns the canvas, the input events, the `.ply` download and the render loop.**

**Props:** `url`, `onUnavailable(reason)` (called if the engine or WebGL2 cannot start, so the caller can fall back), `isEmbedded`.

- `RENDER_MODE = { pointCloud, gaussian }`. The default is Gaussian, and a toggle switches modes (`controlsRef.current.setMode`).
- **`downloadChunks(url, signal, onProgress)`**: streams the response into an **array of chunks**, which `loadPly` accepts without joining them into one buffer. Returns `{ chunks, size }`.
- **Main effect:**
  - `createSplatRenderer(canvas)`. An `EngineUnavailableError` leads to `onUnavailable`.
  - The download is cancelled with an `AbortController`.
  - `engine.loadPly(chunks, name)`, and the status moves through *engine*, then *downloading N%*, then *parsing*, then *ready* or *error*.
  - **Renders on demand.** A `requestAnimationFrame` loop sizes the canvas to `clientWidth × devicePixelRatio`, capped at 2, and calls `engine.render(w, h)` **only when `dirty`**: after input, a resize or a load.
  - **Input**, the same camera as the editor, mapped for mouse and touch:
    - drag orbits; right-drag, middle-drag or Shift-drag pans;
    - the wheel zooms, in notches;
    - **two fingers** pinch to zoom and move together to pan, tracked through a `pointers` Map and `twoFingerState()` (distance and midpoint);
    - double-click resets the view.

    Pointers are captured with `setPointerCapture`.
  - **Clean-up:** cancels the animation frame and the download, removes the listeners, and calls `engine.dispose()`.

---

## `ObjViewer.jsx`
Shows a Wavefront `.obj` with **three.js**. The file is downloaded and parsed in [`objParser.worker.js`](model-files.md#objparserjs--objparserworkerjs), so large scan exports do not freeze the page.

**Props:** `url` (a `blob:` URL for a file from the user's computer), `sizeBytes` (used for progress when the server sends no length), `isEmbedded`, `onInfo({ vertexCount, triangleCount })`.

- **`framingBounds(positions)`**: the centre and radius used to frame the model. It skips stray points so they do not shrink the view.
- `VIEW_DIRECTION`: the initial three-quarter view.
- **Setup:** `WebGLRenderer({ antialias, alpha })`, a `HemisphereLight` and a `DirectionalLight` (the sun), a `PerspectiveCamera(50°)`, and **`OrbitControls`** (drag to orbit, right-drag to pan, scroll to zoom, matching the other viewers). `resetView()` frames the bounds, a `ResizeObserver` calls `resize()`, and `tick()` runs the render loop.
- **When the worker finishes**, it builds a `BufferGeometry` from the **transferred** typed arrays:
  - **with faces:** a `Mesh`. With vertex colours (the engine's and the web app's export) it uses an **unlit** `MeshBasicMaterial({ vertexColors })`, so it shows the captured colours like the engine's `.glb` export. Without colours it uses a lit grey `MeshStandardMaterial`. Both are double-sided.
  - **without faces** (a points export): `Points` with a `PointsMaterial` sized to the model.
- Shows download and parse progress, and errors. On unmount it terminates the worker and disposes the geometry, materials, renderer and controls.
