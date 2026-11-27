# `scene/SceneFile.h` / `SceneFile.cpp`

Saves and opens editor scenes. A scene is a **`.gscene` JSON file** plus a **`<name>_data` folder** beside it:

```
MyScene.gscene             names, transforms, hidden flags, trim values, render mode
MyScene_data/
  model_0.ply              the model's current splats (crops and splat moves included)
  model_0_original.ply     the untrimmed splats, only when the model is trimmed
  model_1.ply
```

Each model's splats are stored **in model space** as a Gaussian `.ply` (written by [SplatExporter](../splat/SplatExporter.md) with an identity transform, read back by [SplatLoader](../splat/SplatLoader.md)), and its transform is stored separately. Loading therefore puts every model back where it was, and every edit made in the editor (trim, crop, moved splats) survives. Because the splats are copied into the folder, a scene does not depend on the original `.ply` files and can be moved to another PC as one folder plus one file. The cost is disk space: each save writes a full copy of every model.

Only Qt Core is used, and both functions are safe to call from a worker thread. [MainWindow](../ui/MainWindow.md#scene-files) calls them.

This is the desktop engine's own format. The web Scene Builder's `genesis.scene` format (`packages/src/backend/schemas/scene.v1.schema.json`) refers to models by server job id and has different trim fields, so the two are not interchangeable.

## The `.gscene` file

```json
{
  "format": "codefine.scene",
  "version": 1,
  "renderMode": "splats",
  "models": [
    {
      "name": "statue.ply",
      "file": "MyScene_data/model_0.ply",
      "originalFile": "MyScene_data/model_0_original.ply",
      "transform": [1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0.5, 0, -2, 1],
      "hidden": false,
      "trimmed": true,
      "trim": { "minAlpha": 0.005, "cropPct": 0.05, "voxelDivisions": 100, "minPerVoxel": 3 }
    }
  ]
}
```

- `renderMode`: `"splats"` (Gaussian Splat) or `"points"` (Point Cloud).
- `file` / `originalFile`: relative to the `.gscene`, with forward slashes. `originalFile` is only present when `trimmed` is true.
- `transform`: the model's 4×4 matrix, 16 numbers in **column-major** order (glm's layout).
- `trim`: the [TrimData](../splat/SplatTrimmer.md) the model was last trimmed with (kept even when not trimmed, so the Inspector shows them).

## Types

| Type | Fields |
|---|---|
| `SceneModel` | `name`, `splats`, `original` (empty unless trimmed), `transform`, `hidden`, `trim`, `trimmed` |
| `Scene` | `gaussianMode`, `models` |
| `SceneResult` | `ok`, `error` (when not ok), `warnings` (problems that did not stop a load) |

## Functions

### `bool IsSceneFile(const QString& path)`
True if the path ends in `.gscene` (any case).

### `SceneResult SaveScene(const Scene& scene, const QString& path)`
1. Writes every model (and its untrimmed copy) into a fresh **`<name>_data.saving`** staging folder. Any failure removes the staging folder and returns the error, leaving the old scene untouched.
2. Writes the JSON through a `QSaveFile`, which does not replace the old `.gscene` yet.
3. Renames the old data folder to `<name>_data.old`, then the staging folder to `<name>_data`. If that fails, the old folder is put back.
4. Commits the `.gscene`, then deletes `<name>_data.old`.

Saving over an existing scene therefore replaces its files completely (no stale `model_N.ply` from a bigger earlier save is left behind), and a failed save does not leave a half-written scene.

### `SceneResult LoadScene(const QString& path, Scene& out)`
Refuses a file that is not JSON, whose `format` is not `codefine.scene`, or whose `version` is newer than 1 (*"saved by a newer version of the engine"*). For each model:
- A missing or unreadable `.ply` skips that model and adds a warning; the others still load.
- An unreadable transform places the model at the origin, with a warning.
- A trimmed model whose untrimmed file is missing loads as not trimmed, with a warning (the trim can no longer be undone).
