# `web-app/PhotoEditorScreen.jsx`

*Author: Bryan.* The **Photo Editor** page checks and prepares photos before reconstruction. Photos come from the device or the photo library. Each one is checked in the browser for blur, bad exposure and near-duplicates ([PhotoChecks](photo-processing.md#photochecksjs--automatic-quality-checks)), and each can be kept or left out.

- **Edits** (auto fix, brightness, contrast, warmth, tint, auto colour, pick a neutral spot, sharpen, crop) **apply to every photo by default**. On desktop a single photo can also be edited on its own (`customEdits`).
- **Warnings** appear for strong settings, lost highlight or shadow detail, large crops and mixed crops.
- **Use original photos** skips every edit.
- **Remove background** and **Keep only the main object** are set here (they cover both captured and uploaded batches), along with the **Model detail** slider.
- **Edits are only settings until upload**, so the original files are never changed.
- **Phones** get a simpler, batch-only set of tools, laid out like the mobile Figma. Generate stays pinned above the tab bar.
- Opened from Capture's *Review photos first*, the batch arrives in `initialPhotos`, and **Back to camera** returns it. Opened on its own, the button reads **Go to camera** and takes any photos added here to the capture page.
- The grid uses [PhotoThumbnails](state-hooks.md#photothumbnailsjs). Checks, edits and uploads use the original files.

**Props:** `onGenerateModel(files, { removeBackground, autoCrop, trainIters })` (App's `handleBatchReady`), `uploadError`, `initialPhotos`, `onBackToCapture`.

## Constants
| Name | Value | Meaning |
|---|---|---|
| `MIN_PHOTOS` | `catalog.minPhotos` (8) | Generate needs at least this many kept photos. |
| `PHONE_MEDIA_QUERY` | `(max-width: 760px)` | The phone layout. |
| `PREVIEW_LONGEST_SIDE` | 900 | Size of the large preview render. |
| `PREVIEW_DELAY_MS` | 150 | The preview redraws this long after the last change, so dragging a slider stays smooth. |
| `MAX_TRIM_PERCENT` | 30 | The "trim edges" crop shortcut. |
| `BATCH_FILTER_ID` | — | The SVG filter id used to preview batch edits on the thumbnails. |
| `STRONG_SETTING_LIMITS` / `_WARNINGS` | brightness 30, contrast 30, warmth 35, tint 35, sharpen 60 | Above these, a warning explains the risk. For example, strong sharpening adds halos that confuse 3D matching. |
| `LARGE_CROP_INSET` | 0.25 | A reminder appears when more than 25% is cut from any side. |
| `CLIPPING_INCREASE_WARNING` | 0.03 | Warns when an edit makes 3% more of the photo pure white or black **than in the original**, so a photo already on a white background does not trigger it. |

## Helper components and functions
| Name | Behaviour |
|---|---|
| `createEditorPhoto(file)` | `{ id: 'photo-N', file, analysisStatus: 'pending', analysis: null, isExcluded: false, customEdits: null }`. |
| `isImageFile(file)` | True for an `image/*` type. |
| `useIsPhone()` | A `matchMedia` hook. |
| `formatSigned(v)` | `+12` or `-5`. |
| `filterIdForPhoto(id)` | The SVG filter id for one photo's own edits. |
| **`ColorFilter({ filterId, edits })`** | An inline SVG `<feComponentTransfer>` with one **linear** function per channel, built from `buildChannelTransfer(edits)`. Thumbnails therefore preview **exactly** what the canvas export will produce, without re-rendering each photo. |
| `EditSlider({ label, settingName, value, min, max, onChange, isSigned })` | A labelled range input. It is highlighted when the value goes past its strong-setting limit. |
| **`CropOverlay({ crop, onChange })`** | Four draggable edges over the preview. `handlePointerDown(edge, e)` captures the pointer and turns drags into inset fractions, clamped so at least `1 − 2 × MAX_CROP_INSET` of the photo remains. |

## `PhotoEditorScreen` state and logic
- State: the `photos` list, `selectedPhotoId`, the edit target (all photos or the selected one), `batchEdits`, `useOriginals`, `removeBackground`, `autoCrop`, `trainIters`, tool flags (cropping, picking a neutral spot, showing the original), and the preview state.
- **Analysis:** an effect runs `analyzePhoto` on pending photos one at a time. **`issuesById = useMemo(findPhotoIssues(photos))`**.
- **`editsFor(photo)`**: the photo's `customEdits`, otherwise `batchEdits`.
- **Warnings that come from these:** `hasMixedCrops` (kept photos have different crops; COLMAP's single shared camera wants every image the same size), `hasLargeCrop`, strong settings, and clipping.
- **Preview:** draws the **original** when *Show original* or *Use originals* is on, the **uncropped** photo with the crop overlay while cropping, and the result otherwise. It uses `renderEditedCanvas(..., 900)` after a 150 ms delay (cancelled on the next change), the same processing as the upload, then measures `measureClippedShare` for the clipping warning. Phones have no large preview.
- **Adding photos:** `openFilePicker`, `openLibraryPicker` ([LibraryPhotoPicker](components.md#libraryphotopickerjsx)), `addFiles`, `handleFileInputChange`, `handleDragOver`, `handleDragLeave`, `handleDrop`.
- **Keeping photos:** `toggleExcluded(id)`, `removePhoto(id)`, `handleThumbnailClick(id)` (select, or toggle on phones), **`leaveOutFlagged()`** (excludes every photo with an issue), `keepAll()`.
- **Edits:** `updateEdits(changes)` (to the batch or to the single photo), `changeEditTarget(target)`, `resetCurrentEdits()`, **`matchAllPhotos()`** (copies the batch edits to every photo, clearing their own edits).
  - **`handleAutoFix()`**: `computeAutoFix(analyses)` over the kept photos (or just the selected one).
  - **`handleAutoColor()`**: averages the R, G and B of the analysed photos and calls `computeWhiteBalance`.
  - **`togglePickNeutral()` / `handlePreviewClick(e)`**: click a spot that should be grey, then `sampleColor` and `computeWhiteBalance`.
  - **Crop:** `toggleCropTool()`, `resetCrop()`, `handleTrimChange(percent)` (the same inset on all four sides).
  - `handleUseOriginalsChange`, `handleRemoveBackgroundChange`, `handleAutoCropChange`.
- `backToCapture()`: `onBackToCapture(files, options)`.
- **`handleGenerate()`**: plays the *confirm* sound and closes the tools. For each kept photo it calls `exportEditedFile(file, editsFor(photo))` (or uses the original file), counting progress in `preparedCount` (*"Preparing N of M"*). Then `await onGenerateModel(files, { removeBackground, autoCrop, trainIters })`. On success App switches to the processing screen. On failure `uploadError` is shown in the bottom bar.
- Renderers: `renderGenerateLabel()`, `renderFooterMessage()` (fewer than 8 photos, the upload error, preparing…), `renderPreviewDetails(photo)` (its issues with `ISSUE_EXPLANATIONS`).
