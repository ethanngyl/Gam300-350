# `ui/GenerateModelDialog.h` / `GenerateModelDialog.cpp`

The engine's counterpart of the web app's capture and Frame Extractor screens. The user picks photos (or videos and GIFs), names the model, chooses the detail level, background removal and auto-crop, and says what happens with the finished model (import it, and optionally also save a Wavefront `.obj`). The model is built **on this PC** by [pipeline/LocalReconstruction](../pipeline/LocalReconstruction.md), so no server or sign-in is needed. This dialog only collects the request and checks that the PC has the tools. It remembers the last choices.

## `struct GenerationFollowUp`
What to do once the model is built. The `.ply` is always saved in `copyFolder`.
- `importIntoScene` (default true).
- `copy`: `None = 0`, `ObjPoints = 2` (one coloured vertex per splat) or `ObjMesh = 3` (one coloured ellipsoid per splat). The numbers match an older server-build dialog, where 1 meant a `.ply` copy, so saved settings stay compatible.
- `copyFolder`.

## Constants
- `kMaxNameLength = 80`, the same limit as the web app's `MAX_JOB_NAME_LENGTH`.
- **Detail presets**, from the web app's `catalog.json`: *Fast* 5000, *Normal* 7000 (the default) and *Detailed* 10000 iterations, plus *Custom…* (item data 0), which shows a 1000–30000 spin box in steps of 500.
- QSettings keys under `generate/`: `source`, `detail`, `customIters`, `fps`, `removeBackground`, `autoCrop`, `import`, `copy`, `copyFolder`, `lastFolder`.

## Helpers
- **`NameFilter(media)`**: file-dialog filter text built from `GenerationSettings`.
- **`FitsSource(media, path)`**: true if `path` is the right kind of file for the chosen source.

## Functions

### `GenerateModelDialog(QWidget* parent)`
Calls `LocalReconstruction::FindTools()` **once**. It builds: an intro; a *Build on* tools hint; a *Build from* combo (Photos or Videos/GIFs); a multi-select file list with *Add Files…*, *Add Folder…*, *Remove* and *Clear* and a count/problem label; *Name*; *Detail* with the custom spin box; *Frames* per second (0.5–30, videos only); the *Remove the background first* and *Keep only the main object* checkboxes; *Import into the scene when it's ready*; *Also save*; and *Save to* (folder plus Browse). The default button is **Generate**. Every option is restored from QSettings, and the controls are wired to `updateControls()`.

### `bool isMedia() const` *(private)*
True when the source is videos.

### `void onSourceChanged()` *(private)*
Removes listed files that do not fit the new source. *Add Folder…* is shown only for photos, and the fps row only for videos. Then calls `updateControls()`.

### `void addFiles()` *(private)*
A multi-file dialog that opens in the last folder (default Pictures) and saves the folder for next time. Then calls `addPaths`.

### `void addFolder()` *(private)*
A directory dialog, then `PhotosInFolder(folder)`. **If no name is set yet, the folder's name becomes the model name**, because capture folders usually describe the object. Then calls `addPaths`.

### `void addPaths(const QStringList&)` *(private)*
Adds files that exist, fit the source and are not already listed (absolute paths are compared). The item shows the file name, with the full path as data and tooltip. For videos, the first file's base name becomes the model name if none is set. Then calls `updateControls()`.

### `void removeSelected()` / `void browseCopyFolder()` *(private)*
`removeSelected` deletes the selected items. `browseCopyFolder` picks the *Save to* folder.

### `void updateControls()` *(private)*
- **Tools check, live**, because background removal and videos also need Python: `LocalReconstruction::MissingTools(request(), m_tools)`. It shows either *"This PC (no server needed). COLMAP and Brush found…"* or the problem in amber.
- **Blocking problems**, in order: `FileCountProblem(media, count)`, an empty *Save to* folder, missing tools. The first one found is shown in amber in the count label and **turns off Generate**. Otherwise the label shows *"N photos/videos"*.
- *Remove* is enabled only with a selection, *Clear* only with files.

### `GenerationRequest request() const`
Builds the request from the controls: source, files, trimmed name, flags, iterations (the preset value or the custom value), and fps (videos only, otherwise 0).

### `GenerationFollowUp followUp() const`
Builds the follow-up from the controls, converting the folder to forward slashes.

### `void accept()`
Saves every choice to QSettings, then calls `QDialog::accept()`.
