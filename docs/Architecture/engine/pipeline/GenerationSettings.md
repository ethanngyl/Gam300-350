# `pipeline/GenerationSettings.h`

Header-only (`namespace generation`). These are the model-generation rules shared by the **Generate Model dialog**, **LocalReconstruction**, **HeadlessBuild** and the **My Models panel**, so they cannot drift apart. Most values **must match the backend**: `catalog.json` `minPhotos`, `config.js` `maxFiles`/`maxMediaFiles`/`minTrainIters`/`maxTrainIters`, and the file filters in `middleware/uploads.js`.

## Constants

| Name | Value | Meaning |
|---|---|---|
| `kMinPhotos` | 8 | Fewest photos a build accepts. |
| `kMaxPhotos` | 400 | Most photos a build accepts. |
| `kMaxMediaFiles` | 10 | Most videos or GIFs per build. |
| `kMinTrainIters` / `kMaxTrainIters` | 1000 / 30000 | Allowed range of training iterations. |
| `kDefaultTrainIters` | 7000 | The web app's *Normal* preset. |
| `kDefaultFps` | 2.0 | Frames taken per second of video (the Frame Extractor default). |
| `kPhotoSuffixes` | jpg, jpeg, png | Photo file types. |
| `kMediaSuffixes` | mp4, m4v, mov, webm, mkv, avi, mpg, mpeg, gif | Video file types. |

## Functions

### `bool IsPhotoFile(const QString& path)` / `bool IsMediaFile(const QString& path)`
Case-insensitive suffix check against the lists above.

### `QStringList NamePatterns(const QStringList& suffixes)`
Turns `{"jpg","png"}` into `{"*.jpg","*.png"}`, for folder scans and file-dialog filters.

### `QStringList PhotosInFolder(const QString& folder)`
Returns every photo directly in `folder` (not in subfolders), **sorted by name, ignoring case**. Name order is usually capture order, and COLMAP's sequential matching works better with it.

### `QString FileCountProblem(bool media, int count)`
Returns an error message for the user, or an empty string if the count is acceptable:
- media and 0 files: *"Add at least one video or GIF."*
- media and more than 10: *"At most 10 videos per model."*
- photos and fewer than 8: *"Add at least 8 photos (N so far)."*
- photos and more than 400: *"At most 400 photos per model."*

### `QString DefaultOutputFolder()`
Returns `<Documents>/Genesis Models`.

### `QString SafeFileName(const QString& name)`
Makes a model or job name safe to use as a file name on any OS:
1. Replaces control characters and `<>:"/\|?*` with `_`.
2. Trims whitespace, cuts to 80 characters, and trims again.
3. Removes trailing dots, which Windows drops silently.
4. If the part before the first dot is a reserved Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`), adds `_` in front. It goes in front rather than at the end because Windows only looks before the first dot.
