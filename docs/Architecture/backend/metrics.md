# `backend/metrics.js`

*Author: Ethan.* Collects **generation statistics** for every `.ply` the pipeline produces: how long each phase took, how many training iterations ran, how large the result is, and what hardware it ran on. Each finished job gets `<jobsDir>/<id>/metrics.json`, plus one line appended to `<jobsDir>/metrics.jsonl` (one JSON object per line), so runs on different machines and settings can be compared later. **Nothing here ever throws into the pipeline**; metrics are best effort. The metrics dashboard reads these files ([frontend/metrics-dashboard](../frontend/metrics-dashboard/README.md)).

## Constants
`METRICS_FILE = 'metrics.json'`, `METRICS_LOG = 'metrics.jsonl'`, `VERSION = 1`, `GPU_SAMPLE_MS = 5000`.

## Functions

### `tryExec(bin, args, timeout = 10 s)` *(private)*
Promise of stdout plus stderr, or `null` if the command cannot run or produces no output. Never rejects.

### GPU probes *(private)*
- **`nvidiaGpus()`**: `nvidia-smi --query-gpu=name,memory.total,driver_version` returns `[{ name, vramMB, driver, vendor: 'NVIDIA' }]`.
- **`windowsGpus()`**: PowerShell reads the display-class **registry** keys (`HardwareInformation.qwMemorySize`), because `Win32_VideoController.AdapterRAM` is a 32-bit field that tops out at 4 GB. Virtual adapters that report no memory are skipped.
- **`macGpus()`**: `system_profiler SPDisplaysDataType -json`. Apple Silicon shares system memory, so it has no VRAM figure. Includes the core count.
- **`linuxGpus()`**: `lspci` lines for VGA, 3D or display controllers (names only).

### `toolVersion(bin, args)` *(private)*
The first line of a tool's output, for example `"COLMAP 4.2.0 (… with CUDA)"`.

### `getHardwareInfo()` *(exported)*
**Probed once and cached** (`hardwarePromise`), because the hardware does not change while the server runs. Returns `{ host, os {platform, release, version, arch}, cpu {model, logicalCores, speedMHz}, memory {totalMB}, gpus, tools {colmap, colmapUseGpu, brush}, node }`. NVIDIA figures are preferred over the OS probe. Errors resolve to `{ error }`.

### `startPhase(job, phase)` *(exported)*
Called from `setPhase` in [pipeline.js](pipeline.md). It creates `job.metrics = { startedAt, phases: [] }` if needed, closes the open phase (sets `endedAt`), and opens a new one when `phase` is given. `startPhase(job, null)` only closes.

### `startGpuSampler(job)` *(exported)*
Polls `nvidia-smi --query-gpu=memory.used,utilization.gpu` every 5 s while Brush trains. It stops quietly if there is no NVIDIA driver. It returns a **stop function** that stores `job.metrics.gpuDuringTraining = { samples, peakVramUsedMB, avgUtilizationPct }`.

### `readPlyHeader(file)` *(exported)*
Reads at most the first 64 KB as latin1 and requires `ply` at the start and an `end_header`. It parses `format`, the `element vertex` count and the vertex property names. Returns `{ format, vertexCount, properties }` or `null`.

### `fileSize(file)` *(private)* / `secs(ms)`
Size in bytes or `null`, and milliseconds to seconds rounded to one decimal place.

### `recordPlyMetrics(job, { rawPly, finalPly, normalized, log })` *(exported)*
1. Closes the last phase and adds up the milliseconds per phase name (a phase can appear more than once).
2. `colmapSec` is features plus matching plus mapping. `trainingSec` comes from the training phase.
3. In parallel: hardware info, the final `.ply` header, and both file sizes.
4. Builds the record:
   - `timing`: `totalSec` (pipeline start to `.ply` ready, excluding upload and queue time), `sinceCreatedSec` (including them), `colmapSec`, `trainingSec`, `phasesSec`.
   - `training`: target iterations, `lastIterationLogged` (Brush logs about every 200 steps, so this may trail the target slightly), `itersPerSec`, `maxResolution`.
   - `input`: image count, sparse models, media fps and frame limit.
   - `output`: splat count, PLY format, properties per splat, raw and final byte sizes, `normalized`, `autoCrop`, and both paths relative to `jobsDir`.
   - `gpuDuringTraining` and `hardware`.
5. Writes `metrics.json` (pretty-printed), appends the compact line to `metrics.jsonl`, and logs a one-line summary (total, COLMAP and training seconds, iterations, splats, MB and GPU) to the job log and the console.

Any error is logged as a warning and the function returns `null`.
