# Web app: state and data modules

---

## `AppearanceSettings.js` (author Bryan)
How the app looks, saved in this browser's `localStorage`. The only setting is the **theme**: `dark`, `light` or `system` (follow the device). The resolved value is applied as `data-theme="dark" | "light"` on `<html>`, and the light colours are defined in `AppTheme.css`. **`index.html` applies the saved theme before the first paint**, so a light-theme user never sees a dark flash; both files use the key `genesis-theme`.

| Item | Behaviour |
|---|---|
| `THEME_CHOICES` | `['dark', 'light', 'system']`. |
| `readStorage` / `writeStorage` *(private)* | Wrapped in `try`, because storage can be blocked (private windows, site data turned off). |
| `loadAppearanceSettings()` *(private)* | The saved theme, or `dark`. |
| `resolvedTheme()` / `applyTheme()` *(private)* | `system` is resolved through `(prefers-color-scheme: light)`, then `data-theme` is set. |
| `updateAppearanceSettings(changes)` *(private)* | **Replaces** the settings object (never edits it in place), so React can tell it changed. Then applies and notifies listeners. |
| `setTheme(theme)` | Ignores unknown values. Saves the theme and updates. |
| `useAppearanceSettings()` | A `useSyncExternalStore` hook that returns `{ theme }`. |
| Module code | Follows device theme changes while the setting is `system`, and applies the theme once on import. |

## `useUndoableState.js` (author Xiong Yang)
React state with an **undo history**, used for the Scene Builder's objects.

`useUndoableState(initialValue)` returns `{ value, set, undo, redo, reset, canUndo, canRedo }`. The history is `{ past, present, future, lastMergeKey }`, with at most **100** past steps.
- **`set(updater, { mergeKey })`**: takes a value or an updater function, like React's setter. If the result is the **same value**, nothing is recorded. Changes that pass the **same `mergeKey` one after another** become **one undo step** (for example, every keystroke while typing in one field). Any new change clears the redo steps.
- **`undo()` / `redo()`**: move one step between past, present and future, and clear the merge key.
- **`reset(value)`**: replaces the value and clears the history.

## `PhotoThumbnails.js` (author Gabriel)
Small thumbnails for the photo grids on the capture page and in the Photo Editor. A 12 MP photo takes about **48 MB once decoded**, so showing originals made the browser discard and decode them again while scrolling. The original file is still what is checked, edited and uploaded.
- `THUMBNAIL_WIDTH = 480`, wide enough to stay sharp in the largest grid tile on a high-DPI screen.
- **`makeThumbnailUrl(file)`**: `createImageBitmap(file, { resizeWidth })` shrinks while decoding and keeps the orientation. It is then drawn onto a canvas (still scaled for browsers that ignore the resize option), saved with `toBlob('image/webp', 0.8)` (PNG where there is no WebP encoder), and returned as an object URL. Rejects if the browser cannot read the file (for example HEIC outside Safari).
- **`usePhotoThumbnails(photos)`**: returns `{ [id]: url | null }`.
  - Makes **one thumbnail at a time**, in list order. Each finished thumbnail updates the map, which starts the next.
  - Releases the object URLs of removed photos. A thumbnail that finishes after its photo was removed is released straight away.
  - Releases every URL when the component unmounts.
  - A photo that cannot be read gets `null`, so the grid can show a placeholder.

## `ProfilePhoto.js` (author Bryan)
The **browser-only** profile photo: a 256×256 centre-cropped JPEG data URL in `localStorage` under `genesis-profile-photo:<email>`. It is from before the backend stored avatars (`/auth/me/avatar`) and is kept for screens that still read it.
- **`useProfilePhoto(email)`**: a `useSyncExternalStore` hook returning the data URL or `null`.
- **`saveProfilePhoto(email, file)`**: `loadImage` (into an `<img>`; the object URL is always revoked), centre-crop to a square, draw at 256×256, `toDataURL('image/jpeg', 0.85)`, save, notify. It throws a friendly error if the file is not an image or storage is full.
- **`removeProfilePhoto(email)`**: removes it and notifies.

## `LibraryPhotos.js` (author Bryan)
Reading the photo library for the *Add from library* picker.
- **`smallPhotoUrl(url)`**: appends `?size=small` (or `&size=small`) to get the backend's ~480 px WebP copy. Full 12 MP photos made the Library stutter. Downloads and photos added to a batch still use the original URL.
- **`fetchLibraryBatches()`**: `GET /api/v1/jobs`, keeping only jobs that have images.
- **`guessImageType(fileName, blobType)`** *(private)*: the blob's type if it starts with `image/`, otherwise a guess from the extension (jpg, jpeg, png, webp, heic), defaulting to JPEG. The batch screens only accept files whose type starts with `image/`.
- **`downloadLibraryPhoto(jobId, image)`**: fetches the original and returns a `File` named `<8-char id>-<name>`, so it can join a batch exactly like a photo picked from the device.
