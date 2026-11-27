# Web app: photo processing (`PhotoChecks.js`, `PhotoEdits.js`)

*Author: Bryan.* Browser-side image maths for the **Photo Editor** ([PhotoEditorScreen](screens.md#photoeditorscreenjsx)). Everything works on canvases. There is no server involvement until upload.

---

## `PhotoChecks.js`: automatic quality checks
`analyzePhoto()` measures each photo on a **downscaled copy** (longest side 256 px) so it stays fast, and `findPhotoIssues()` turns the measurements into flags.

### Constants
| Name | Value | Meaning |
|---|---|---|
| `ANALYSIS_LONGEST_SIDE` | 256 | Size of the analysis copy. |
| `HASH_WIDTH × HASH_HEIGHT` | 9 × 8 | Difference-hash grid (64 bits). |
| `BLUR_RATIO_OF_MEDIAN` | 0.4 | Blurry means less than 40% of the batch **median** sharpness. It is relative because raw sharpness depends heavily on the camera and the subject. |
| `MIN_PHOTOS_FOR_BLUR_CHECK` | 3 | With fewer photos the median means nothing, so the check is skipped. |
| `TOO_DARK_BELOW` / `TOO_BRIGHT_ABOVE` | 45 / 215 | Average-brightness limits (0–255). |
| `DUPLICATE_MAX_DIFFERENT_BITS` | 2 | Kept low on purpose: turntable shots are meant to look alike. |
| `ISSUE_LABELS` / `ISSUE_EXPLANATIONS` | — | Text for `blurry`, `duplicate`, `dark` and `bright`. |

### Functions
| Function | Behaviour |
|---|---|
| `toGrayscale(rgba, n)` | Luma `0.299R + 0.587G + 0.114B` as a `Float32Array`. |
| `drawToGrayscale(bitmap, w, h)` / `drawToPixelBytes(bitmap, w, h)` | Draw onto a `willReadFrequently` canvas and read the pixels back. |
| `measureSharpness(gray, w, h)` | **Variance of the Laplacian** (the 4-neighbour kernel). Sharp photos have strong edges, so the variance is high. |
| `averageOf(values)` | Mean. |
| `differenceHashBits(gray)` | One bit per horizontal pixel pair: is the left pixel brighter than the right? Similar photos give nearly identical bits. |
| `countDifferentBits(a, b)` | Hamming distance between two hashes. |
| `measureColorStats(bytes, gray, w, h)` | Average R, G and B; `centerBrightness` (the middle 60% of the frame, where the object usually is); `tonalSpread` (standard deviation of brightness); `clippedShare`. These feed auto fix, auto colour and the "lost detail" warning. |
| **`analyzePhoto(file)`** | `createImageBitmap`, scale down, then returns `{ sharpness, brightness, hashBits, …colorStats }`. **Throws** if the browser cannot decode the file (for example HEIC outside Safari), which the caller treats as "couldn't check". |
| **`findPhotoIssues(photos)`** | Over the analysed photos it computes the median sharpness. For each photo, in order, it flags **blurry** (below 0.4 × median, only with ≥ 3 photos), **dark** or **bright**, and **duplicate** (a hash within 2 bits of the **previous analysed** photo). Returns `{ [id]: [...issues] }`. |

---

## `PhotoEdits.js`: edits, previews and export
An *edits* object holds `brightness`, `contrast`, `warmth`, `tint` (each −50 to 50), `sharpen` (0 to 100) and `crop` (the fraction cut from each side). **The canvas export and the SVG filters used for thumbnails are both built from `buildChannelTransfer`**, so the previews match the upload exactly.

### Constants
`NO_CROP`, `DEFAULT_EDITS`. `MAX_CROP_INSET = 0.45`: at least 10% of the photo always remains. `SHARPEN_STRENGTH_AT_MAX = 1`, kept low because strong sharpening adds halos that confuse feature matching. Auto fix aims for a brightness of **125**, a spread of **50**, and changes of at most **±25**. White balance is limited to **±50**, and only samples whose channels lie between **15 and 250** are trusted. A pixel counts as clipped when all three channels are ≥ **250** or ≤ **5**. Crops within **0.005** of each other count as the same.

### Functions
| Function | Behaviour |
|---|---|
| `clamp`, `averageOf` *(private)* | Helpers. |
| `hasCrop(crop)`, `hasColorChange(edits)`, `hasEdits(edits)` | Quick checks used to skip work. |
| `cropsMatch(a, b)` | Every edge within tolerance. Used to tell whether a crop was applied to all photos. |
| `channelGains(edits)` *(private)* | Warmth trades red against blue (`1 ± warmth/200`). Tint moves green against the other two (`1 − tint/200`). |
| **`buildChannelTransfer(edits)`** | One straight line per channel on 0–1 values: `out = slope·in + intercept`, with `slope = gain × (1 + brightness/100) × (1 + contrast/100)` and `intercept = 0.5 − 0.5 × contrastFactor` (contrast around the midpoint). |
| `buildChannelMapping(transfer)` *(private)* | A 256-entry `Uint8ClampedArray` lookup table, which clamps and rounds automatically. |
| `measureClippedShare(bytes)` | The share of pixels that are pure white or pure black. |
| `sharpenPixels(bytes, w, h, strength)` *(private)* | **Unsharp mask** against the 3×3 average, built in two passes (rows, then columns) so large photos stay reasonably fast. |
| **`renderEditedCanvas(file, edits, maxLongestSide = ∞)`** | Crops the source rectangle, optionally scales it down (for previews), then applies the colour lookup tables and sharpening only when needed. |
| **`exportEditedFile(file, edits)`** | **An unedited photo is returned unchanged**, so it keeps its camera details (EXIF). Otherwise it renders at full size and saves a JPEG at quality 0.92 named `<name>-edited.jpg`. If the browser cannot decode the file, it returns the original rather than failing the whole upload. |
| **`computeAutoFix(analyses)`** | From the average centre brightness and spread: brightness `(125/centre − 1)·100` clamped to ±25, and contrast **only ever added** for flat photos, clamped to 0–25. Returns `null` for no analyses. |
| **`computeWhiteBalance(r, g, b)`** | Warmth and tint that turn this average colour into a neutral grey: warmth `200(b/r − 1)/(b/r + 1)` and tint `200(1 − green gain relative to the mean of the red and blue gains)`, each clamped to ±50. Returns `null` if the colour is too dark or too close to white. |
| **`sampleColor(file, crop, fx, fy)`** | Renders the **unedited** photo (crop only, at 400 px) and averages a 7×7 spot at the clicked fraction, for the "pick a neutral spot" tool. |
