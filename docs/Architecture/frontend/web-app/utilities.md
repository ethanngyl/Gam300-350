# Web app: entry point and small utility modules

These are plain JS modules under `packages/src/web-app/`. They have no UI of their own.

---

## `main.jsx`
The browser entry point, loaded by `index.html`.
- Imports `pageLoadTiming.js` (reports this page's load time) and `AppearanceSettings.js` (applies the saved light or dark theme), both for their side effects.
- `createRoot(#root).render(<StrictMode><App /></StrictMode>)`.
- The comment above the render says StrictMode is *intentionally omitted*, because it would mount the WebGL viewer twice in development and download the `.ply` twice. **The current code does wrap `<App />` in `<StrictMode>`.** The comment and the code disagree, so whoever changes this file should settle which one is right.
- `index.css` is imported elsewhere and is commented out here.

## `AppRoutes.js` (author Gabriel)
The **address-bar hash for each page**, so Back and Forward move between pages and a refresh stays on the same page. Hash URLs need nothing from the server: every page is still served from `/`.
- `TABS`: `home, library, editor, scene, viewer, extractor, capture, account, feedback`.
- Hashes:
  - `#/<tab>`, `#/library/photos`;
  - `#/processing/<jobId>` (a build in progress);
  - `#/extractor/uploading` (a Frame Extractor upload with no job yet; loading it means the upload was lost);
  - `#/model/<jobId>` (the full-page viewer);
  - `#/viewer/file` (a local `.ply`).
- **`viewToHash({ activeTab, librarySubTab, screen, jobId })`**: the reverse mapping, from view to hash.
- **`hashToView(hash)`**: parses the hash and returns `{ activeTab, librarySubTab, screen, jobId, wasUploadInterrupted? }`. **Anything unknown or malformed gives Home.** Job ids must match `^[\w-]+$`, the same rule as the backend.

## `catalog.js` (author Ethan)
The website's **reference data**, read once from `GET /api/v1/catalog` with a **top-level `await`**, so every module that imports it (directly, or through `FeedbackCategories.js`, `TrainingPresets.js` or `mediaJobs.js`) can use the values as plain constants.
- **`fetchCatalog()`**: up to 3 attempts, 1 s apart, so a server that is just starting is waited for.
- **`showUnreachable(error)`**: replaces `#root` with *"Couldn't reach the server, so the app can't start."* and a **Retry** button that reloads the page. It then rethrows, so the app does not start.
- `export const catalog = Object.freeze(data)`.

## `FeedbackCategories.js` / `TrainingPresets.js`
- `FEEDBACK_CATEGORIES = catalog.feedbackCategories` (id, label, icon, placeholder) and `FEEDBACK_MESSAGE = catalog.feedbackMessage` (min and max length).
- `TRAINING_PRESETS = catalog.trainingPresets`, and `DEFAULT_TRAINING_ITERATIONS`, the iterations of `catalog.defaultTrainingPreset`. The chosen value is sent to the backend as `trainIters`.

## `plans.js` (author Bryan)
**Prototype** subscription plans (prices are not decided yet, and everyone is on Free).
- `PLANS`: *Genesis Free* (5 GB, 10 models a month, OBJ), *Pro* (100 GB, unlimited, all formats, featured) and *Max* (1 TB, priority, PLY splat, commercial licence).
- `CURRENT_PLAN_ID = 'free'`, and `currentPlan()`.

## `mediaApi.js` (author Xiong Yang)
Calls the Media Library makes. Each one resolves with the JSON reply or rejects with the server's `{ error }` message.
- `request(url, options)` and `jsonBody(method, body)` *(private)*.
- **`jobDisplayName(job, prefix)`**: `job.name`, or `"<prefix> <first 8 chars of id>"`.
- **`renameJob(id, name)`**: `PATCH /api/v1/jobs/:id`. An empty name resets the job to its default name.
- **`deleteJob(id)`**: `DELETE /api/v1/jobs/:id/files`. A job is both a model and its photo batch, so they go together.

## `mediaJobs.js` (authors Ethan, Bryan)
Helpers for building from videos and GIFs, shared by `FrameExtractor.jsx` and `App.jsx`.
- `MEDIA_EXT_RE` (the same list as the backend), `MAX_MEDIA_FILES` and `MAX_MEDIA_SIZE_MB` (from the catalog), and `MEDIA_ACCEPT = 'video/*,image/gif,.mkv,.avi'` (browsers do not list every video type under `video/*`).
- **`uploadMedia(files, { fps, trainIters, removeBackground, autoCrop }, onStart, onProgress)`**: `POST /api/v1/jobs/from-media` through **XMLHttpRequest**, because `fetch` cannot report **upload** progress. `onStart(xhr)` lets the caller abort. Resolves with the job id. Rejects with readable errors: a 413 with no JSON body means *"This connection refused an upload that large…"* (a proxy or tunnel); no JSON at all means the server is unreachable; otherwise the server's error. An abort rejects with `{ aborted: true }`.
- **`formatFileSize(bytes)`**: `"12.4 MB"` or `"1.2 GB"`.

## `fetchWithProgress.js` (author Xiong Yang)
- **`streamWithProgress(url, sizeHint, onChunk, onProgress)`**: reads `res.body` with a `getReader()` and calls `onChunk(Uint8Array)` and `onProgress(fraction | null)` for each piece. The total comes from `Content-Length` or `sizeHint`. Returns the number of bytes received.
- **`fetchWithProgress(url, sizeHint, onProgress)`**: collects the chunks into one `ArrayBuffer`. The `.obj` export and viewer workers use it.

## `pageLoadTiming.js` (author Gabriel)
Runs once on import. After `load` (plus one more turn, because `loadEventEnd` is only set after the load handlers finish), it reads **Navigation Timing**: `ttfb`, `fcp` (from the paint entry), `domContentLoaded` and `load`, each in ms rounded to 0.1. It sends them with **`navigator.sendBeacon`** (falling back to `fetch(…, { keepalive })`) to `POST /api/v1/metrics/page-load`. Missing APIs mean nothing is sent, and any error is ignored, so measuring never breaks the page.

## `codefineEngine.js` (author Ethan)
Re-exports `loadEngineFactory` from `@codefine/splat-renderer`, so older imports keep working. **`isEngineAvailable()`** resolves true if the compiled WebAssembly engine can be loaded.

## `menuPosition.js` (author Xiong Yang)
**`menuPosition(event)`**: where to open a `ContextMenu`. The keyboard menu key reports `(0, 0)`, so in that case it uses the element's top-left corner plus 12 px. It lives in its own file so `ContextMenu.jsx` only exports components, which keeps React fast refresh working.

## `useMobileView.js` (author Bryan)
`MOBILE_QUERY = '(max-width: 760px)'`, the same width the CSS uses. **`useMobileView()`** is a `useSyncExternalStore` hook over `matchMedia`. It returns true in the mobile layout (where the phone `Dock` replaces the sidebar and top bar) and re-renders when the window crosses that width.
