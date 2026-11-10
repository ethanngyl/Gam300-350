# @codefine/splat-renderer

The Codefine engine's Gaussian splat renderer, compiled to WebAssembly, with a
small JavaScript API. It is the same C++ the desktop editor uses
(`engine/src/splat`, `engine/src/gfx`), built for WebGL2, so a `.ply` looks
the same in the browser as in the editor.

The web app (`packages/`) installs it as a package and uses it in
`src/web-app/EngineSplatViewer.jsx`.

- Version: see `package.json`; changes: [CHANGELOG.md](CHANGELOG.md)
- Needs a browser with WebGL2 and WebAssembly

## What's in the package

| File | What it is |
| --- | --- |
| `index.js` | The JavaScript API below |
| `index.d.ts` | TypeScript types for it |
| `dist/codefine-engine.js`, `dist/codefine-engine.wasm` | The compiled engine (built, not committed) |
| `example/index.html` | A standalone page that loads a `.ply` |

## Build the engine

`dist/` is build output, so build it once (and again after changing anything
in `engine/src/splat`, `engine/src/gfx` or `engine/web`):

- Windows: double click `engine/build-web.bat`
- macOS / Linux: `./engine/build-web.sh` (needs `git`, `python3`, `cmake`)

The first run downloads the Emscripten SDK into `engine/Library/emsdk`. The
web app's start scripts and the Docker image run this build for you.

## Install

The web app installs it from this folder:

```json
"dependencies": {
  "@codefine/splat-renderer": "file:../engine/web/package"
}
```

Any other project in this repo can do the same with its own relative path,
then `npm install`.

The page must serve `dist/` somewhere the browser can fetch it (the `.js`
loads the `.wasm` next to itself). By default the API looks for it at
`/engine/codefine-engine.js`; pass `engineUrl` to use another place. The web
app's `vite.config.js` serves it at `/engine/` in development and copies it
into the build.

## Use

```js
import { createSplatRenderer, RenderMode, EngineUnavailableError } from '@codefine/splat-renderer'

const canvas = document.querySelector('canvas')
let renderer
try {
  renderer = await createSplatRenderer(canvas) // or { engineUrl: '/static/codefine-engine.js' }
} catch (error) {
  if (error instanceof EngineUnavailableError) showOtherViewer(error.message) // not built, or no WebGL2
  else throw error
}

const bytes = await (await fetch('/api/v1/jobs/sample-fox/result.ply')).arrayBuffer()
const count = renderer.loadPly(bytes, 'fox.ply') // splat count; throws if the file can't be read
renderer.setRenderMode(RenderMode.Gaussian)

// You own the render loop and the input: draw when something changed.
function frame() {
  requestAnimationFrame(frame)
  renderer.render(canvas.width, canvas.height)
}
requestAnimationFrame(frame)

canvas.addEventListener('pointermove', (e) => {
  if (e.buttons) renderer.orbit(e.movementX, e.movementY)
})

// When the canvas goes away:
renderer.dispose()
```

## API

| Name | Description |
| --- | --- |
| `createSplatRenderer(canvas, { engineUrl?, printErr? })` | Starts an engine instance drawing into `canvas`. Resolves to a `SplatRenderer`. Rejects with `EngineUnavailableError` if the engine isn't built or WebGL2 is missing. |
| `renderer.loadPly(data, name?)` | Adds a `.ply` (ArrayBuffer, Uint8Array, or a list of Uint8Array chunks). Returns its splat count. |
| `renderer.clear()` | Removes every model. |
| `renderer.setRenderMode(mode)` | `RenderMode.Gaussian` or `RenderMode.PointCloud`. |
| `renderer.splatCount` | Splats across all models. |
| `renderer.orbit(dx, dy)` / `pan(dx, dy)` / `zoom(notches)` / `resetCamera()` | Camera, in CSS pixels and wheel notches (same as the desktop editor). |
| `renderer.render(width, height)` | Draws one frame at the canvas' drawing-buffer size. |
| `renderer.dispose()` | Frees the GPU resources; later calls do nothing. |
| `loadEngineFactory(engineUrl?)` | The raw Emscripten factory, for the C API (`cf_*` in `engine/web/WebMain.cpp`). |

## Example

`example/index.html` is a complete page: pick a `.ply`, then drag to orbit,
Shift or right-drag to pan, scroll to zoom.

```
cd engine/web/package
python -m http.server 8080
```

Then open http://localhost:8080/example/ and pick a file from
`engine/assets/samples/` (for example `fox.ply`).

## Versioning

[Semantic Versioning](https://semver.org/). Every change gets a version bump
in `package.json` and an entry in [CHANGELOG.md](CHANGELOG.md), in the same
commit.
