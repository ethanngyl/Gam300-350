# `ui/AssetPaths.h`

Header-only (`namespace AssetPaths`). Works out where the engine's bundled assets and per-user data live at runtime, so an installed copy works on machines that do not have the source tree.

## Functions

### `QString AssetsDir()`
Returns `<exe dir>/assets` if that folder exists, which is the case for an installed or packaged build. Otherwise it falls back to `ENGINE_ASSETS_DIR`, the source tree's `engine/assets` path that CMake bakes in for dev builds. A `QCoreApplication` must already exist.

### `QString AssetsSubdir(const QString& name)`
Returns `AssetsDir() + "/" + name`, for example `samples`.

### `QString UserDataDir()`
The writable per-user folder `QStandardPaths::AppDataLocation`. On Windows that is `%APPDATA%/CoDefine/Codefine Engine`. The folder is created if it does not exist. It is used instead of the install folder because that may be read-only (Program Files). Logs, metrics, local builds and the remote-model cache all live here.

### `void PruneOldFiles(const QString& folder, const QString& pattern, int keep)`
Lists the files in `folder` that match `pattern`, sorted by name, and deletes the oldest until only `keep` remain. **File names must sort by time** (for example `..._20261120_075751...`). Used so per-run logs and metrics do not pile up.
