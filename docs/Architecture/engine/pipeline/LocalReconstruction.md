# `pipeline/LocalReconstruction.h` / `LocalReconstruction.cpp`

Builds a Gaussian splat model **on this PC with no server**. It is the engine-side port of the backend's reconstruction pipeline ([backend/pipeline.js](../../backend/pipeline.md)) and runs the same tools with the same settings, one after another:

| Step | Tool | Phase name | Progress band |
|---|---|---|---|
| Frames from videos *(media only)* | `python tools/extract_frames.py` | `extract` | 0 – 5% |
| Foreground masks *(remove background only)* | `python tools/make_masks.py` | `masking` | up to 5% |
| Feature extraction | `colmap feature_extractor` | `colmap-features` | 5% |
| Matching | `colmap exhaustive_matcher` | `colmap-matching` | 20% |
| Sparse mapping (camera poses) | `colmap mapper` | `colmap-mapping` | 35% |
| Training | Brush | `training` | 45 – 98% |
| Auto-crop *(optional)* and normalize | [SplatAutoCrop](SplatAutoCrop.md), [PlyNormalizer](PlyNormalizer.md) | `crop` / `normalize` | 99% |

Each tool runs as a `QProcess`, so the editor never freezes. Slow C++ work (probing the tools, copying files, cropping and normalizing) runs on a worker `QThread`. The finished `.ply` is saved into the chosen folder, the working files are deleted, and a log of every tool's output is kept under `<user data>/local-builds/logs` (the newest 20).

## Nested types

### `struct Tools`
Where the tools were found (an empty string means not found): `toolsDir`, `colmap`, `brush`, `python`, `nvidiaSmi`.

### `struct ToolStep` *(private)*
One tool run: `phase`, starting `progress`, `program`, `args`, `workDir`, `env` (empty means inherit), an `onLine(line)` parser for progress, `timeoutMs` (0 means no limit), and an optional `failMessage` shown instead of *"<tool> exited with code N"*.

### `struct Prepared` *(private)*
What the preparation step found out about this PC's COLMAP and Brush builds:
- `colmapGpu`: true only for a CUDA build of COLMAP **and** an NVIDIA GPU.
- `extractionNs` / `matchingNs`: `FeatureExtraction`/`FeatureMatching` in COLMAP 4.x, or `SiftExtraction`/`SiftMatching` in 3.x.
- `minInliersFlag`: `--TwoViewGeometry.min_num_inliers`, or the older `--<matchingNs>.min_num_inliers`.
- `skipRedundantPoints`: the mapper supports `--Mapper.ba_global_ignore_redundant_points3D` (new in COLMAP 4).
- `itersFlag`: `--total-steps` in Brush v0.3.0, `--total-train-iters` in newer builds.
- `alphaMode`: Brush supports `--alpha-mode`.
- `error`.

## Constants
These must match the backend's `config.js` defaults: `kMaxResolution = 1024`, `kMaxFrames = 200`, `kFrameTimeoutMs = 30 min`, `kMaskModel = "isnet-general-use"`, `kKeepLogs = 20`. `kNoModelMessage` is the text of `NO_MODEL_MESSAGE` in `pipeline.js`.

## Static functions

### `Tools FindTools()`
1. **tools/ folder:** tries `GENESIS_TOOLS_DIR`, then `tools/` next to the exe and in up to 5 parent folders, then `ENGINE_ASSETS_DIR/../../tools` (the source tree). The first folder that has a `colmap/` or `brush/` subfolder wins.
2. **COLMAP:** `COLMAP_BIN`, then the shallowest file matching `^colmap(.exe)$` under `tools/colmap`, then `colmap` on PATH.
3. **Brush:** `BRUSH_BIN`, then `^brush[\w-]*(.exe)$` under `tools/brush`, then `brush_app` or `brush` on PATH.
4. **Python:** `FindPython()`.
5. **nvidia-smi:** looked up on PATH.

The order (environment variable, then tools/, then PATH) is the same as in `config.js`.

### `QString MissingTools(const GenerationRequest&, const Tools&)`
Lists what is missing: COLMAP, Brush, and, when the request needs Python (videos or background removal), Python and the right script (`tools/extract_frames.py` or `tools/make_masks.py`). It returns a message telling the user to run `tools/get-tools.ps1`, plus `pip install -r tools/requirements.txt` when Python is needed. It returns an empty string when the PC is ready.

### `QString BuildsRoot()`
Returns `AssetPaths::UserDataDir()/local-builds`.

## Lifecycle

### `LocalReconstruction(QObject* parent)`
Creates a single-shot `m_timeout` timer. When it fires, it sets `m_timedOut` and calls `killTool()`.

### `~LocalReconstruction()`
Sets `m_cancelled`, kills and waits up to 3 s for any running tool, and **waits for the worker thread**, because a running `QThread` must never be destroyed. If the save worker had already moved the model into place but its `done()` never ran (the app quit during *Finalizing model*), it deletes that file, because the quit prompt promised nothing would be kept. Finally it removes the work files.

### `void start(const GenerationRequest& request, const QString& outputFolder)`
1. Resets all state. The id is `local_yyyyMMdd_HHmmss_zzz`, the workspace is `BuildsRoot()/<id>` and the export folder is `BuildsRoot()/<id>_out`.
2. Opens the log at `logs/<id>.log` (after pruning to 20 logs), sets the phase to `upload`, and logs the inputs and tool paths.
3. Fails immediately if `MissingTools()` reports anything.
4. **Worker thread (`runWorker`):**
   - Probes with `RunForOutput`: `colmap -h` contains *"with CUDA"* and `nvidia-smi -L` matches `^GPU \d+:`, which sets `colmapGpu`. The `COLMAP_USE_GPU` environment variable overrides this.
   - Reads the help text of `feature_extractor`, `exhaustive_matcher` and `mapper` to find the flag namespaces and optional flags. `COLMAP_SKIP_REDUNDANT_POINTS=0` turns off the redundant-points flag.
   - Reads `brush --help`. Empty output means *"Brush could not be started"*.
   - Copies the inputs into `images/` (or `media/`) with stable ordered names `0000.jpg`, `0001.png` and so on, as the backend's upload does.
5. `onPrepared()` then runs on the main thread.

### `void onPrepared(const Prepared&)` *(private)*
Reports a cancel or an error if there was one. Otherwise it stores the probe results, logs them, and continues with **extractFrames** (media), **generateMasks** (photos with background removal) or **runColmap**.

### `void extractFrames()` *(private)*
Runs `python extract_frames.py <media files…> --output images --fps <fps> --max-frames 200` with a 30-minute timeout. It parses `PROGRESS extract <fraction>` lines into 0–5% progress. Afterwards it deletes `media/`, counts the frames, and fails with advice if there are fewer than 8. It then continues to masks or COLMAP.

### `void generateMasks()` *(private)*
Runs `python make_masks.py images --colmap-out colmap_stencils --brush-out masks --model isnet-general-use`. This makes **two mask sets**: Brush reads `masks/` automatically, and `colmap_stencils/` is kept in its own folder so Brush does not see two masks per image. Progress comes from `PROGRESS mask <fraction>` lines. Afterwards it sets `m_colmapMaskArgs = --ImageReader.mask_path colmap_stencils`.

### `void runColmap()` *(private)*
Chains three tool steps:
- **feature_extractor**: `--ImageReader.single_camera 1`, the mask arguments, and `--<ns>.use_gpu`.
- **exhaustive_matcher**: min inliers 50 and guided matching on. These are the backend's "strict" settings, which stop symmetric or low-texture objects from getting cameras on the wrong side (ghost copies).
- **mapper**: `init_min_num_inliers 200`, `abs_pose_min_num_inliers 60`, `abs_pose_min_inlier_ratio 0.35`, plus the redundant-points flag when it is supported. On 311 photos that flag cut mapping from 29.9 to 18.8 minutes. If the mapper fails, the user sees `kNoModelMessage`.

After mapping it checks that `sparse/` contains at least one numbered model folder (`0`, `1`, …) and otherwise fails with `kNoModelMessage`.

### `void train()` *(private)*
Runs Brush from `BuildsRoot()` with paths relative to it, exactly as the backend does: `<id> --max-resolution 1024 <itersFlag> N --export-path ./<id>_out/ --export-name splat_{iter}.ply --export-every N`. N is the requested iteration count clamped to 1000–30000. With background removal and `alphaMode` supported, it adds `--alpha-mode transparent`, so the background trains as empty space instead of a haze. It sets `RUST_LOG=info`, because Brush only prints its progress bar to a real terminal, and parses `iter=N` from the log lines into 45–98% progress with an *"Iteration N / M"* detail.

### `void finishModel()` *(private)*
1. Picks the highest-iteration `*.ply` export (the last one in name order, excluding `result.ply`).
2. **Worker thread:** optionally runs `AutoCropSplatPly(sparse, raw, cropped.ply)` (best effort: on failure or skip the whole model is kept and the reason logged). It then runs `NormalizeSplatPly(…, result.ply, 1.5)` (also best effort: on failure the raw export is used). Exceptions are caught, because one escaping a worker thread would end the editor. It then creates the output folder, picks a free name (`<name>.ply`, `<name> (2).ply`, …, where the name comes from `SafeFileName`, defaulting to `Model yyyy-MM-dd HHmm`), and `rename`s the file, or `copy`s it when the folder is on another drive. The result is saved in `m_unclaimedResult`.
3. **Done (main thread):** writes the worker's log lines. If cancelled, it deletes the saved model. If only the save failed, it calls `fail(..., keepExport = true)` and tells the user where the trained model is, so a long build is not thrown away. Otherwise it calls `complete(path)`.

### `void cancel()`
Sets `m_cancelled`, logs the cancel, and kills the running tool. The tool's `finished` handler, or the worker's `done`, then reports *"Cancelled."*.

## Tool runner

### `void runTool(ToolStep step, std::function<void()> next)` *(private)*
- Fails at once if cancelled. Sets the phase if it changed. Logs `$ tool args…`.
- Creates a `QProcess` with no console window and merged stdout/stderr, and applies the working folder and environment.
- **Line splitting:** both `\r` and `\n` end a line, because tools draw progress bars with `\r`. Each line is logged, remembered as `m_lastLine`, checked for `^ERROR:` (the scripts' error convention, saved as `m_scriptError`) and passed to `step.onLine`. A partial last line is kept for the next read.
- `errorOccurred(FailedToStart)` fails with *"Couldn't start <tool>"*.
- `finished`: stops the timeout and drains the remaining output. Then, in order: if cancelled, it reports *"Cancelled."*; if timed out, *"<tool> timed out after N min"*; on a non-zero exit or crash, the first available of `failMessage`, `m_scriptError`, *"crashed"* or *"exited with code N"*, followed by `: <last line>` when no specific message exists. Otherwise it calls `next()`.

### `void runWorker(std::function<void()> work, std::function<void()> done)` *(private)*
`QThread::create(work)`, then `done()` on the main thread when the thread finishes. It saves the thread in `m_worker` so the destructor can wait for it.

### `void killTool()` *(private)*
On Windows it runs `taskkill /PID <pid> /T /F` (5 s timeout), so the **whole process tree** dies, as `killChild` in `pipeline.js` does, and nothing keeps the GPU or files busy. It then calls `QProcess::kill()`.

## State reporting

- **`setPhase(phase, progress, detail)`** and **`setProgress(progress, detail)`** update `m_status` and emit `statusChanged`.
- **`log(line)`** appends UTF-8 to the log file and flushes.
- **`fail(error, keepExport)`** runs once per build. It sets `status` to `cancelled` or `error`, emits `statusChanged`, removes the work files (keeping the export folder if asked and not cancelled), then emits `finished("", error)`, or `"Cancelled."` when cancelled.
- **`complete(path)`** sets `status` and `phase` to `done`, progress to 1 and `hasResult`, emits `statusChanged`, removes the work files and emits `finished(path, "")`.
- **`removeWorkFiles(keepExport)`** deletes the workspace (and the export folder unless `keepExport`). If a just-killed tool still holds a file on Windows, it tries again once after 2 s.

## Helpers (anonymous namespace)

- **`HideConsole(process)`**: adds `CREATE_NO_WINDOW` on Windows, so console tools do not flash a window from this GUI app.
- **`RunForOutput(program, args, cancelled, timeout = 15 s)`**: a blocking run with merged output, used only on the worker thread. It polls every 100 ms and kills the process once cancelled or past the timeout. It returns an empty string if the program could not run.
- **`ExistingFile(path)`**: the absolute path if the file exists, else an empty string.
- **`FindUnder(dir, regex)`**: the shallowest file under `dir`, searched recursively, whose name matches `regex`.
- **`FindPython()`**: `PYTHON_BIN`. On Windows it otherwise walks PATH for `python.exe`, **skipping `Microsoft\WindowsApps`** (that Store alias opens the Store instead of running anything). On other systems it uses `python3`.

## Signals
- `statusChanged(const JobStatus&)` has the same shape as the backend's `GET /jobs/:id`.
- `finished(resultPath, error)` has an empty error on success and `"Cancelled."` when cancelled.
