# Web app: capture, video input and build progress

---

## `CameraCapture.jsx`
*Authors: Bryan and others.* The **in-browser photo capture page**.
- A **camera panel**: live preview, **Manual** or **Auto** (interval) capture with an adjustable photo cap, and **Space** as a shortcut for both.
- A **batch panel**: drag-and-drop and file-picker uploads, *Add from library* ([LibraryPhotoPicker](components.md#libraryphotopickerjsx)), live thumbnails ([PhotoThumbnails](state-hooks.md#photothumbnailsjs)) with per-photo removal, the **Remove background** and **Keep only the main object** options, the **Model detail** slider ([TrainingQualitySlider](#trainingqualitysliderjsx)), and the button that sends the batch.
- On phones it becomes the mobile Figma's **full-screen camera**: close at the top left, the shot count, upload at the top right, Manual/Auto above the shutter, and the last photo and *Done* beside it (both open the batch in the Photo Editor).

**Props:** `onBatchReady`, `onReviewPhotos`, `onBack`, `uploadError`, `initialPhotos` (`{ files, removeBackground, autoCrop, trainIters }` handed back from the Photo Editor), `addedFiles` (photos chosen with *Upload photos* before the page opened), `onRegisterAddFiles`.

### Constants and helpers
- `HARD_CAP = 200` (the highest auto-capture cap). `SUGGESTED_PHOTO_COUNT = 40` (phones show *"12 / 40 shots"*).
- **`isShortcutBlockedBy(target)`**: Space keeps its normal job while typing or on a focused control outside the camera panel. The camera's own buttons always use the shortcut.
- `ISSUE_SUMMARY_PHRASES`: builds the warning, for example *"3 look blurry, 2 are near-duplicates"*.
- **`readFocusSupport(track)`**: reads `getCapabilities()` and `getSupportedConstraints()` to find the continuous or single-shot autofocus mode, whether **tap-to-focus** (`pointsOfInterest`) is supported, and the manual `focusDistance` range. Many desktop webcams offer none of these.
- **`clickToFramePoint(event, video)`**: turns a click on the preview into a 0–1 point on the camera frame. The preview uses `object-fit: cover`, so the hidden overflow is added back first. Also returns where to draw the focus ring.
- **`createBatchPhoto(file)`**: `{ id, file, analysisStatus: 'pending', analysis: null }`.

### Behaviour
- **Camera start:** `getUserMedia({ video: { facingMode: 'environment', width 1920, height 1080 (ideal) } })`. It reads the focus support and switches to **autofocus** so photos start sharp. On failure it shows *"Camera unavailable: …"* and the preview reads *"Click to enable camera"* (`retryCamera`). The stream's tracks are stopped on unmount.
- **Focus:** `handlePreviewClick` (tap-to-focus with `pointsOfInterest`, plus a ring), `handleAutoFocus`, `handleFocusDistanceChange` (manual focus), and `showFocusNote` for feedback.
- **`addFiles(fileList)`**: keeps only `image/*` files, appends batch entries, and returns the count. While the page is open it is **registered with App**, so *Upload photos* in the sidebar adds straight into this batch and shows *"N photos uploaded"*.
- **`capturePhoto(showFeedback)`**: draws the video frame onto a canvas and plays the **shutter sound** (at half volume for auto-capture), then `toBlob('image/jpeg', 0.9)` and adds `capture-<time>.jpg` to the batch.
- **Auto-capture:** a `setInterval` every `intervalSeconds` that stops at the cap. The count is read **from refs**, so a new photo does not restart the timer and stretch every interval.
- **Space:** in Manual mode it takes a photo; in Auto mode it starts or stops capture. Ignored while the library picker is open.
- **Background checks:** every pending photo goes through `analyzePhoto`, and `findPhotoIssues` outlines the flagged ones. A note then suggests *Review photos first*.
- Handlers: `handleModeChange`, `handleBrowseClick`, `handleFileInputChange`, `handleDragOver`, `handleDragLeave`, `handleDrop`, `handleLibraryPhotos`, `removePhoto`.
- **`handleReview()`**: `onReviewPhotos(files, { removeBackground, autoCrop, trainIters })`, which opens the Photo Editor.
- **`handleTrain()`**: `onBatchReady(files, opts)`, which uploads the batch and starts the build.

---

## `FrameExtractor.jsx`
*Authors: Bryan and Ethan.* The **Video Extractor** page. The user chooses videos or animated GIFs, a frame rate, **Remove background** (on by default) and model detail. The drop zone, the chosen files, fps and **Process media** share one box, with a note underneath on how frames are picked.
- **`createMediaItem(file)`** / **`MediaPreview({ item })`**: a file card with a video or GIF preview through an object URL.
- `addFiles` checks against `MEDIA_EXT_RE`, `MAX_MEDIA_FILES` and `MAX_MEDIA_SIZE_MB` ([mediaJobs.js](utilities.md#mediajobsjs)) and explains anything it rejects. Also `removeMediaItem`, `handleFileInputChange`, `handleDragOver`, `handleDrop`, `handleBrowseClick`.
- **`handleSubmit()`**: `onStartBuild({ files, fps, trainIters, removeBackground, autoCrop })`. App then opens the full-screen Processing view, which shows the upload as its first step.
- `initialDraft` fills the form in again after a failed or cancelled build. `notice` shows a message in the error line, for example after a reload stopped an upload. There is no Back button; the sidebar or dock handles navigation.

---

## `TrainingQualitySlider.jsx`
*Author: Bryan.* The **Model detail** slider with three stops, *Fast / Normal / Detailed*, from `TRAINING_PRESETS` (the catalog). Only the heading, the slider and the stop labels are shown; the iteration count is kept out of sight. **The stop labels can also be clicked** (`choosePreset(index)`). Props: `iterations` (the current cap), `onChange(newCap)`, `disabled`. The default stop is `NORMAL_PRESET_INDEX = 1`.

---

## `Processing.jsx`
The screen shown while the backend builds a job. It **polls the server**, shows the phase and progress, and hands off to the model page once the splat is ready.

**Props:** `jobId` (`null` while a media upload is still running), `mediaBuild` (Frame Extractor builds: `{ label, fileCount, fps, removeBackground, autoCrop, previewUrl, isGif, uploadFraction, startError }`), `onDone`, `onCancel`, `onRegisterLeaveGuard`.

### Constants
- **`PHASE_LABELS`**: upload (*Uploading photos*), masking (*Removing backgrounds*), colmap-features (*Analyzing photos*), colmap-matching (*Matching photos*), colmap-mapping (*Recovering camera positions*), training (*Training 3D model*), crop (*Keeping the main object*), normalize (*Finalizing model*), done.
- **`MEDIA_PHASE_LABELS`**: the same, but *Uploading media*, *Extracting frames*, and "frames" instead of "photos".
- `PHASE_ORDER` / `MEDIA_PHASE_ORDER`: used only to draw the step tracker. **The masking step is shown only if background removal is on, and the crop step only if auto-crop is on.**
- `STEP_STATE_LABELS`. **`formatElapsed(s)`** gives `m:ss`.

### Behaviour
- **Polling:** `GET /api/v1/jobs/:id` **every 1.5 s**.
  - A new phase while running plays a **tick** sound (not on the first poll).
  - `done` plays **success** and calls `onDone()` once (guarded by `doneRef`).
  - `error` plays **error** and shows the message with tips.
  - `cancelled` while away (Back then Forward, or a reload) calls `onCancel()`.
  - A failed request shows *"Job not found (did the server restart?)"*.
- **Waiting in the queue:** while the job is `queued`, the upload step shows as done, and `job.detail` (for example *"Waiting for your earlier build to finish"*) explains the wait.
- **Preview:** once frames exist (for media builds, after extraction), it loads the job's first photo from `GET /api/v1/jobs` and shows it with a **scanning effect**, plus the photo count. Before that, a media build shows its first file.
- **Elapsed timer:** a 1 s interval.
- **Leave guard** (registered with App): while the build runs, the browser's Back and Forward ask *"Leave this page? The build will be cancelled."* (skipped once the build has failed or finished).
- **`killJob()`**: sends `DELETE /jobs/:id` with `keepalive` on **`pagehide` or unmount**, **unless the job already finished**, so its result stays downloadable. Leaving the screen in any way therefore tells the server to stop COLMAP and Brush rather than leave them running on the GPU for nobody.
- **`cancel()`**: kills the job, then calls `onCancel()`.
- **`stepState(index)`**: `done`, `active` or `pending` for each step in the tracker.
- **Layout:** on wide screens, the live status (current step, iteration counter from `detail`, progress bar, elapsed time, Cancel) sits beside the preview and step tracker. On phones it is one column, with a banner preview and a full-width Cancel button.
