# `engine/web/package/`: `@codefine/splat-renderer`

The engine's splat renderer compiled to WebAssembly, behind a small JavaScript API. It is the same C++ as the desktop editor, so a `.ply` looks the same in the browser. The web app installs it with `"@codefine/splat-renderer": "file:../engine/web/package"` and uses it in `EngineSplatViewer.jsx`.

| File | Purpose |
|---|---|
| `index.js` | The JS API (below). |
| `index.d.ts` | TypeScript types for it. |
| `dist/codefine-engine.js/.wasm` | Build output from `engine/build-web.bat` or `.sh`. Not committed. |
| `example/index.html` | Standalone page that loads a `.ply` with a file input. |
| `README.md`, `CHANGELOG.md`, `package.json` | Docs and version. |

## Build (`engine/web/CMakeLists.txt`)
- Must be configured with `emcmake`. Otherwise it stops with a `FATAL_ERROR` that points to `build-web.bat`.
- C++20, Release by default. Only the portable dependencies are imported: **glm** and **happly** (no Qt, GLEW or FMOD).
- Sources: `WebMain.cpp`, `SplatLoader`, `SplatModel`, `SplatRenderer`, `Shader`, `Camera`, compiled with `-DCODEFINE_GLES`.
- `-fwasm-exceptions`, because happly reports bad files by throwing and `SplatLoader` catches it.
- Link flags: `MODULARIZE`, `EXPORT_ES6`, `EXPORT_NAME=createCodefineEngine`, web environment only, WebGL 2 only, `ALLOW_MEMORY_GROWTH` with `MAXIMUM_MEMORY=4GB` (a 1–2M splat `.ply` plus its decoded copies needs far more than the default heap), and exports `_malloc`, `_free`, `ccall` and `HEAPU8`.
- Output goes to `package/dist`. An old cached output path (the web app's `public/engine`) is migrated automatically.

## `index.js` exports

### `RenderMode`
`Object.freeze({ PointCloud: 0, Gaussian: 1 })`, matching what `cf_set_render_mode` takes.

### `DEFAULT_ENGINE_URL = '/engine/codefine-engine.js'`
Where the page is expected to serve `dist/`. The web app's Vite config serves it at `/engine/`.

### `class EngineUnavailableError extends Error`
Thrown when the engine cannot run (not built, or no WebGL2), so the caller can fall back to another viewer.

### `loadEngineFactory(engineUrl = DEFAULT_ENGINE_URL)`
Resolves the URL against `location.href` and does a **runtime** `import()` (marked `@vite-ignore`, because the `.js` loads its `.wasm` from beside itself). The result is cached **once per URL** in a `Map`. **A failed import is removed from the cache**, so building the engine and trying again works without reloading the page.

### `loadPlyInto(engine, data, name)` *(internal)*
Accepts an `ArrayBuffer`, a `Uint8Array`, or an **array of chunks** (for example from a stream). It throws on empty input. It calls `_malloc(total)` (throwing if there is not enough memory) and copies each chunk into `engine.HEAPU8`, **reading `HEAPU8` after `malloc`**, because growing the heap replaces its buffer. It calls `cf_load_ply` through `ccall`: −1 throws *"not ready, or already holds as many models as it can"*, and 0 or less throws *"could not read this .ply"*. It always frees the pointer in a `finally`.

### `createSplatRenderer(canvas, { engineUrl, printErr })`
1. Gives the canvas an id (`codefine-splat-N`) if it has none, because the engine finds it by id.
2. Loads the factory. A failure becomes `EngineUnavailableError("…run engine/build-web.bat")`.
3. Creates a **new engine instance per call**, each with its own memory, so several canvases can each have one. `printErr` defaults to `console.warn('[Engine]', …)`.
4. `cf_init('#id')`. A return of 0 becomes `EngineUnavailableError('This browser does not support WebGL2.')`.
5. Returns a `SplatRenderer` object. Every method is wrapped in `live(fn)`, so **calls after `dispose()` do nothing** and late input events are harmless.
   - `loadPly(data, name = 'model.ply')` returns the splat count.
   - `clear()`, `setRenderMode(mode)`, the `splatCount` getter (0 after dispose).
   - `orbit(dx, dy)`, `pan(dx, dy)`, `zoom(notches)`, `resetCamera()`.
   - `render(width, height)`.
   - `dispose()` runs once and calls `cf_shutdown`, logging rather than throwing if the instance has already stopped (for example after running out of memory).
