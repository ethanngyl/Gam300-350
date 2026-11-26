# Pipeline helper scripts (`tools/*.py`)

The backend ([pipeline.js](../pipeline.md), [services/jobs.js](../services/jobs.md)) runs these Python scripts as child processes. So does the engine's [LocalReconstruction](../../engine/pipeline/LocalReconstruction.md), for videos and background removal. They share one convention: **progress lines** `PROGRESS <step> <0..1>` and errors as `ERROR: <message>` go to **stderr**, failures exit with code 1, and a JSON summary goes to stdout where there is one. Dependencies are listed in `tools/requirements.txt`. COLMAP and Brush are downloaded by `tools/get-tools.ps1` / `get-tools.sh` / `get-tools-linux.sh`.

---

## `extract_frames.py` (author Ethan)
Extracts **sharp, non-duplicate frames spread evenly across one or more videos or animated GIFs** as JPEGs numbered `0000.jpg`, `0001.jpg`, …, continuing from one file to the next, ready for COLMAP. Uses OpenCV.

`python extract_frames.py <files…> -o <dir> [--fps N | --every N] [--max-frames N] [--no-filter] [--clean] …`

- `eprint`, `fail(message)` (writes `ERROR:` and exits 1), `progress(f)` (writes `PROGRESS extract f`), `require_deps()` (a clear message if OpenCV or numpy are missing).
- `_decode_error(label)` gives a readable message for files that cannot be decoded. `read_video_info(path, label)` returns `(fps, frame count)`.
- `_sharpness(gray)`: variance of the Laplacian. `_analysis_images(frame)`: a downscaled grey copy and a thumbnail used for comparisons.
- **`extract_frames(...)`**: works out a fractional **stride** (from `--every`, or the source fps divided by the requested fps), then **widens** it so `max_frames` covers the **whole** video instead of only its first seconds. In each slot it keeps the **sharpest of up to 5 neighbouring frames** to avoid motion blur. It skips **near-duplicates** of the last written frame (paused or static video) and at the end drops frames much blurrier than the rest. Calls `report(fraction)` as it goes and returns the number of frames written.
- **`main()`**: shares `--max-frames` out between the files **in proportion to their length**, runs each file, and prints `{"frames": N, "output": dir}`.

## `make_masks.py`
**Foreground masks** for optional background removal. Turntable captures need them: the still room makes COLMAP decide the camera never moved, so the splat comes out flat. The photos are **never modified**. It writes two mask sets (white = object, black = background): `--colmap-out <name>.<ext>.png` (COLMAP's `mask_path` naming) and `--brush-out <stem>.png` (Brush picks up `<dataset>/masks/` automatically).
- Uses **rembg** (model `isnet-general-use` by default, about 170 MB, downloaded to `~/.u2net` on first use). It runs on an NVIDIA GPU if `onnxruntime-gpu` is installed, otherwise on the CPU.
- `MODEL_SIZE = 1024`: photos are shrunk to this size with a fast filter before rembg sees them, and the mask is scaled back up, which skips rembg's slower full-size resizing.
- `load_session(model)`: creates the rembg session and picks the GPU provider when available.
- **`clean_mask(alpha, dilate_frac)`**: thresholds the alpha at 128, keeps only connected components at least **10% the size of the largest** (dropping stray specks), **fills holes** so texture inside the object is never masked, and **dilates** the mask a little so the silhouette edge, where many good features are, stays inside it.
- A mask covering less than `MIN_COVERAGE = 1%` of the photo means segmentation missed the object, so that photo is left unmasked.
- `main()`: loops over the photos, writes both sets, and prints `PROGRESS mask f`.

## `normalize_ply.py`
Recentres and rescales a Gaussian-splat `.ply` into the viewer's frame: a **median** centre, a **90th-percentile** radius scaled to `--target-radius 1.5`, `ln(factor)` added to `scale_0..2`, and the header kept byte for byte. `read_ply`, `write_ply`, `median`, `percentile`, `normalize`, `main`. The engine's C++ port, which uses the same maths, is documented in [engine/pipeline/PlyNormalizer](../../engine/pipeline/PlyNormalizer.md).

## `auto_crop.py`
Crops a trained splat down to the **main object of a walk-around capture**, working from COLMAP's camera poses: the centre is the point closest to every viewing ray (least squares, dropping rays that miss), up is the average of the camera up vectors, the footprint is the convex hull of the camera path **plus its mirror image** (so a partial arc still gives a closed region), and the height is cut where the counts of sparse points in thin layers fall away. It writes a `--report` JSON. Its functions (`sub/add/scale/dot/cross/length/normalized/median/solve3`, `read_cameras_from_images_bin`, `read_points3d_bin`, `pick_model_dir`, `closest_point_to_rays`, `ray_miss`, `find_centre`, `convex_hull`, `radial_profile`, `largest_gap_degrees`, `height_limits`, `build_region`, `inside_footprint`, `inside`, `read_ply_layout`, `crop_ply`, `main`, `report`) are the ones the engine port follows step for step. See [engine/pipeline/SplatAutoCrop](../../engine/pipeline/SplatAutoCrop.md) for the algorithm and thresholds.

## `make_cover.py`
`python make_cover.py <images> <masks> <out.webp> [--size 512]`. Makes the job card **cover**: the object cut out of one photo.
- `measure(mask_path)` returns `(shows the whole object, coverage)`. "Whole" means the mask does not touch the frame's edges.
- `main()` picks, among the photos that show the whole object, the one where it **covers the most of the frame** (if none shows it whole, the largest). It makes the background transparent with that photo's mask, **shrinks the mask slightly** to remove the rim `make_masks.py` added with dilation, crops around the object, turns it upright by EXIF (masks match the photo's stored pixels, so the mask is applied before rotating), scales it to fit `--size`, and saves a WebP.

## `make_thumbs.py`
`python make_thumbs.py <images> <out> [--size 480] [--only NAME …]`. Small **WebP** copies for the website's cards. The Library used to show full 12 MP photos, which made scrolling stutter. Each `<name>` becomes `<out>/<name>.webp`, keeping the full name so `x.jpg` and `x.png` do not collide.
- `is_fresh(photo, thumb)`: a copy that already exists and is newer than its photo is left alone, so a second run is quick.
- `make_thumb(photo, thumb, size)`: Pillow, turned upright by EXIF and scaled down to fit.
- `main()`: one run handles a whole job, because starting Python costs more than making a thumbnail. A photo that cannot be read is skipped with a warning, and the backend then serves the original.

---

## `packages/api-tests/` (API smoke test)
`api-smoke.sh` (and `api-smoke.bat`, which runs it through Git Bash) tests the backend's HTTP API with **nothing but `curl`**. It is a second client of the same API as the website, alongside the engine's `BackendClient`. It reads `API_BASE_URL`, `API_EMAIL` and `API_PASSWORD` from `.env` or the environment, and optionally `API_PREFIX` (default `/api/v1`; empty tests the legacy paths). Each check prints `PASS` or `FAIL` with the HTTP status, and the exit code is 0 only if everything passes.
