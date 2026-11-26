# `backend/config.js`

*Authors: Xiong Yang, Gabriel.* The backend's **central configuration**. It finds the COLMAP, Brush and Python executables, **probes them once at startup** for GPU support and the right command-line flags, and exports one `config` object that every other backend file reads. Any value can be overridden with an environment variable or an optional `.env` file next to this file (see `.env.example`). The `.env` is loaded first; `ENV_FILE` names a different file, and a file that does not exist means none is read, which the tests rely on.

## Tool discovery helpers

| Function | Behaviour |
|---|---|
| `findExe(roots, re, fallback)` | For each root in order, walks the folder tree (depth first) and returns the first file whose name matches `re`. Unreadable folders are skipped. Returns `fallback` if nothing matches. A search is needed because the release zips extract into subfolders whose names vary. |
| `findOnPath(name)` | Absolute path of `name` if it is in a folder on `PATH`, otherwise `null`. |
| `findPython()` | `python3` on non-Windows systems. On Windows, the first `python.exe` on PATH **outside `Microsoft\WindowsApps`** (the Store stub that only prints "Python was not found", exit code 9009). If none is found, it returns `python`. |
| `colmapHasCuda(exe)` | Runs `exe -h` (10 s timeout) and checks for `with CUDA`. |
| `hasNvidiaGpu()` | `nvidia-smi -L` exits with 0 and prints `^GPU \d+:`. |
| `readBrushHelp(exe)` | `brush --help` output, or `''`. |
| `brushItersFlag(help)` | `--total-steps` (v0.3.0) if the help lists it, else `--total-train-iters` (main branch). The wrong name makes Brush exit with code 2. |
| `colmapUsesFeatureNamespace(exe)` | `feature_extractor --help`: `--FeatureExtraction.use_gpu` means 4.x (true), `--SiftExtraction.use_gpu` means 3.x (false). Defaults to true. |
| `colmapMinInliersFlag(exe, ns)` | `--TwoViewGeometry.min_num_inliers` if the matcher lists it, else `--<ns>.min_num_inliers`. |
| `colmapMapperHasFlag(exe, flag)` | Whether `mapper --help` lists `flag`. |
| `parseOrigins(value)` | Splits `GOOGLE_RETURN_ORIGINS` on commas and checks that each entry is an `http(s)` URL (otherwise it **exits the process** with an error), returning the origins. |
| `limitSetting(name, fallback)` | Rate-limit environment variable as a whole number ≥ 0. Unset gives the fallback; 0 means off. |

## Derived values
- `colmapBin`: `COLMAP_BIN`, then `tools/colmap`, `../gsplat-tools/bin`, `../gsplat-tools`, PATH, a default path.
- `brushBin`: `BRUSH_BIN`, then `tools/brush`, `gsplat-tools/brush/target/release`, PATH (`brush_app`).
- `colmapUseGpu`: `COLMAP_USE_GPU`, or `'1'` only for a CUDA build **and** an NVIDIA GPU.
- `brushItersFlagName` (override with `BRUSH_ITERS_FLAG`) and `brushHasAlphaMode`.
- The extraction and matching namespaces. `COLMAP_LEGACY_FLAGS=1` forces the 3.x names and `0` forces the 4.x names.
- **Strict COLMAP settings** (`COLMAP_STRICT` is on unless set to `'0'`): matcher min inliers 50 and guided matching; mapper `init_min_num_inliers 200`, `abs_pose_min_num_inliers 60`, `abs_pose_min_inlier_ratio 0.35`. These stop symmetric, low-texture objects from getting cameras on the wrong side.
- **Fast mapper:** `--Mapper.ba_global_ignore_redundant_points3D 1` when supported, unless `COLMAP_SKIP_REDUNDANT_POINTS=0`.
- `authMode`: must be `local`, `client` or `authority`, otherwise the process exits.
- `jobSources`: a comma list of `live` and/or `sample`, otherwise the process exits.

## The exported `config` object (main groups)

| Group | Keys (default) |
|---|---|
| Server and folders | `port` (5005), `jobsDir` (`backend/jobs`), `dataDir` (`backend/data`), `engineSamplesDir`, `repoRoot`. |
| Tools | `colmapBin`, `brushBin`, `pythonBin`, and the scripts `frameScript`, `normalizeScript`, `autoCropScript`, `maskScript`, `coverScript`, `thumbScript`, and `maskModel` (`isnet-general-use`). |
| Build queue | `maxRunningJobsPerUser` (1), `maxRunningJobs` (0 = no machine-wide cap). |
| Training | `trainIters` (10000), `minTrainIters` 1000, `maxTrainIters` 30000, `maxResolution` (1024), `brushItersFlag`, `brushHasAlphaMode`. |
| COLMAP | `colmapUseGpu`, `colmapExtractionUseGpuFlag`, `colmapMatchingUseGpuFlag`, `colmapStrictMatcherArgs`, `colmapStrictMapperArgs`, `colmapFastMapperArgs`. |
| Uploads | `maxJsonBodyMB` 2, `maxFiles` 400, `maxFileSizeMB` 30, `maxMediaFiles` 10, `maxMediaSizeMB` (2048), `maxResultSizeMB` 500, `maxAvatarKB` 256. |
| Frames | `frameFps` (2), `frameMaxFrames` (200), `frameMaxFps` 30, `frameTimeoutMin` (30). |
| Data sources | `catalogFile`, `jobSources`, `sampleDataFile`. |
| Storage | `fileStore` (`disk` or `db`), `filesInDb` (db **and** authority), `storageBudgetGB` (0 = never delete), `cleanupMinAgeDays` (7), `feedbackKeepDays` (365), `cleanupIntervalMin` (60), `minFreeDiskGB` (2). |
| Shared library | `machineName` (hostname), `syncIntervalMin` (5). |
| Performance | `perfKeepDays` (7), `perfFlushSec` (60). |
| Accounts | `authMode`, `vmAuthUrl` (trailing `/` removed), `authApiKey`, `allowInsecureAuth` (`AUTH_ALLOW_HTTP=1`), `trustProxy`. |
| Rate limits | `rateLimitApiPerMin` (600), `rateLimitBuildsPerHour` (10), `rateLimitBuildsPerDay` (30), `rateLimitDownloadsPerHour` (60). |
| Google SSO | `googleClientId`, `googleClientSecret`, `googleRedirectUri`, `googleAuthUrl`, `googleTokenUrl`, `googleReturnOrigins`, `googleHandoffTtlSec` (60). |
| Mail | `smtpHost`, `smtpPort` (465), `smtpUser`, `smtpPass`, `mailFrom`, `mailOutboxDir`, `resetCodeTtlMin` (15). |

The full list of environment variables with explanations is in `backend/.env.example`.
