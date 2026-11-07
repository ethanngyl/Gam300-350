# Changelog

All notable changes to `@codefine/splat-renderer` are listed here, newest
first. The version follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0 -> 2.0.0): a change that breaks callers, e.g. a function
  removed or renamed, or a different argument.
- **MINOR** (0.1.0 -> 0.2.0): something new that existing callers don't
  notice, e.g. a new function or option.
- **PATCH** (0.1.0 -> 0.1.1): a fix with no change to the API.

While the version is 0.x, a MINOR bump may still break callers; every such
change is marked **Breaking** below.

Bump `version` in `package.json` and add an entry here in the same commit as
the change.

## 0.1.0 - 2026-11-08

First packaged release.

- `createSplatRenderer(canvas, { engineUrl, printErr })`: starts an engine
  instance drawing into a WebGL2 canvas. Each call gets its own instance.
- `SplatRenderer`: `loadPly` (an ArrayBuffer, a Uint8Array or a list of
  chunks), `clear`, `setRenderMode`, `splatCount`, `orbit` / `pan` / `zoom` /
  `resetCamera` (same units as the desktop editor), `render`, `dispose`.
- `RenderMode` (`PointCloud`, `Gaussian`), `DEFAULT_ENGINE_URL`,
  `EngineUnavailableError` (engine not built, or no WebGL2),
  `loadEngineFactory`.
- TypeScript types (`index.d.ts`) and a standalone example (`example/`).
- The WebAssembly build (`engine/build-web.bat` / `.sh`) now writes
  `codefine-engine.js` / `.wasm` into this package's `dist/` instead of the
  web app's `public/engine/`.
