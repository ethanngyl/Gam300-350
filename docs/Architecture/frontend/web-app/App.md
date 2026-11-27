# `web-app/App.jsx`

*Author: Bryan.* The **top-level app shell**. It decides what is on screen, owns the cross-page state (the session, the active page, the current build, the scene being edited), and talks to the backend for the session, the photo upload and logout.

## What it renders
1. **While checking the session** (`isCheckingSession`): an empty page, so no screen makes requests with an expired session.
2. **Signed out:** [LandingScreen](screens.md#landingscreenjsx). For `#/login` or `#/signup`, [LoginScreen](auth-account.md#loginscreenjsx) in sign-in or create-account mode (keyed by mode, so switching resets it).
3. **A build in progress** (`screen === 'processing'`): the full-screen [Processing](capture-processing.md#processingjsx) view.
4. **The old gallery** (`screen === 'gallery'`): [ImageGallery](components.md#imagegalleryjsx).
5. **The dashboard:**
   - wide screens: [TopNav](shell.md#topnavjsx) and [Sidebar](shell.md#sidebarjsx);
   - **760 px wide or less:** TopNav (compact) and the phone [Dock](shell.md#dockjsx), with no top bar on Capture or the model page;
   - the page for `activeTab`: Home, Library, Photo Editor, Scene Builder, Model Viewer, Frame Extractor, Capture, Account, Feedback, or the model page (`ModelScreen`);
   - on wide screens **Account opens as a window over the previous page** (`accountReturnTab`).

   The page container is keyed by the page, so each page opens scrolled to the top.

   Also shown when needed: the [Walkthrough](shell.md#walkthroughjsx) the first time each account signs in on this browser, and [NameModelPrompt](components.md#namemodelpromptjsx) after a build finishes.

## Module-level helpers
| Function | Behaviour |
|---|---|
| `authPageFromHash(hash)` | `#/login` gives `login`, `#/signup` gives `signup`, anything else `landing`. |
| `toRouteView(state)` / `fromRouteView(view)` | Convert between App's state and [AppRoutes](utilities.md#approutesjs). App shows the model page as the `model` tab, while the routes use the old `result` and `local-model` screen names. A local `.ply` cannot be reopened from a hash alone. |
| `hasSeenWalkthrough(email)` / `markWalkthroughSeen(email)` | `localStorage` key `genesis-walkthrough-seen:<email>`. If storage is blocked, it counts as seen, so the walkthrough does not appear on every visit. |
| `loadSavedUser()` / `saveUser(user)` | The cached profile in `localStorage` (`genesis-session`). Every access is wrapped in `try`. |
| `TAB_LABELS`, `UPLOAD_INTERRUPTED_NOTICE` | The model page's back-link text, and the Frame Extractor notice shown when an upload was lost. |

## State
- `currentUser` (from the cache), `authPage`, `isCheckingSession`, `isMobile` (`useMobileView`).
- Navigation: `activeTab`, `librarySubTab`, `screen`, `jobId`, `viewedModel` (`{ jobId }` or `{ localFile: { url, name, sizeBytes } }`; the object URL of a local file is revoked when it changes), `modelReturnTab`, `accountReturnTab`.
- Media builds: `mediaBuild` (label, file count, fps, flags, `previewUrl`, `uploadFraction`, `startError`), `abortMediaUploadRef`, `mediaBuildCountRef` (a **generation counter** so results from an old upload are ignored), `frameExtractorDraft`, `frameExtractorNotice`.
- Photo hand-offs between pages: `photosForEditor`, `photosForCapture`, `photosToAdd`, and `addToCaptureBatchRef` (Capture registers its add-files function here).
- The Scene Builder's **undoable** objects (`useUndoableState([])`) and `sceneInfo`, kept here so the scene survives switching pages.
- `namePromptJobId`, `uploadError`, walkthrough replay flags.

## Effects
- **Session check on start:** `GET /api/v1/auth/me`. 200 saves a fresh copy (so role changes show up). 401 clears a stale cache. If the backend is unreachable, the cached profile is kept so the page still renders.
- **Address bar:** whenever the view changes, it writes `viewToHash(...)` with `pushState`, or `replaceState` after `replaceNextRef` is set (for redirects and finished builds).
- **`popstate`** (Back and Forward):
  - If a **leave guard** is registered (Processing, during a build) and it refuses, the old hash is pushed back.
  - Otherwise it parses the hash, stops any media build if the new page is not processing, restores the local model if one is still open, clears the photo hand-offs and restores the page.
- **`beforeunload`** while a media upload is running, so the browser asks before closing the tab.
- Cleans up the media preview URL.

## Functions
| Function | Behaviour |
|---|---|
| `showAuthPage(page)` | Pushes `#/`, `#/login` or `#/signup` and scrolls to the top. |
| `handleLogin(user)` | Caches the user and goes to Home. |
| `handleSignOut(nextPage)` | `POST /api/v1/auth/logout` (without waiting), clears the cache, the screen and the scene, and replaces the hash. |
| `handleSignOutOrSignIn()` | Guests go to `login`, everyone else to `landing`. |
| `goToTab(tab)` | Clears the upload error, the photo hand-offs and the extractor draft, then sets the tab. |
| `addPhotosToCapture(files)` | If Capture is already open, adds the files to its batch directly. Otherwise opens Capture with them. |
| `reviewPhotosInEditor(files, opts)` / `returnPhotosToCapture(files, opts)` | Move a batch between Capture and the Photo Editor, keeping `removeBackground`, `autoCrop` and `trainIters`. |
| `openLibrary(subTab)`, `openAccount()` | `openAccount` remembers the page to return to. |
| **`handleBatchReady(files, opts)`** | Builds a `FormData` (`removeBackground`, `autoCrop`, optional `trainIters`, and the `images`) and calls `POST /api/v1/upload`. On success it sets `jobId` and shows `processing`. On failure it sets `uploadError`. |
| `backToDashboard()` | Clears `screen`. |
| `resetJob()` | Cancel or close a build: stops the media build and returns to the Frame Extractor or Home. |
| `stopMediaBuild()` | Increments the generation counter, aborts the upload and clears `mediaBuild`. |
| **`startMediaBuild({ files, fps, trainIters, removeBackground, autoCrop })`** | Keeps the draft (so *Back* can restore the form), creates the preview URL, and shows Processing **straight away** with the upload as its first step. It calls `uploadMedia(...)`. The abort hook only aborts **before all bytes are sent**. Upload progress is reported at whole-percent steps. **If the build was abandoned in the meantime, it deletes the new job** (`DELETE /jobs/:id`, `keepalive`). On success it sets `jobId`. On failure it plays an error sound and sets `startError`. |
| `showModelPage(model, returnTab)` | Opens the `model` tab with a back link. |
| `handleProcessingDone()` | Opens the model page for the finished job and asks for a name (`NamePromptJobId`). |
| `openModel(jobId)` | Opens a server model. From Account on a wide screen, the back link returns to the page under Account. |
| `openLocalModel(file)` | Opens a `.ply` from the user's computer through an object URL. |
| `addModelToScene(model)` | `createSceneObject` (named *"(2)"* and so on for repeats), marks the scene unsaved, and opens the Scene Builder. |
| `showWalkthroughAgain()` / `closeWalkthrough()` | Replay the walkthrough, or mark it seen. |
