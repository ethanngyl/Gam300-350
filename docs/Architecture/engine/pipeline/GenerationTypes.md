# `pipeline/GenerationTypes.h`

Plain data types passed around by a model build. They are kept apart from the network client so the local build, the Generate Model dialog and the command-line build need no server.

## `struct GenerationRequest`
What to build a model from. It offers the same choices as the web app's capture and Frame Extractor screens.

| Field | Default | Meaning |
|---|---|---|
| `source` | `Photos` | `Photos` (.jpg/.png, at least 8) or `Media` (videos or GIFs; frames are extracted first). |
| `files` | — | Absolute input paths. |
| `name` | empty | Model name. Empty means a default name is used. |
| `removeBackground` | false | Mask out the background before COLMAP. Suits turntable captures. |
| `autoCrop` | false | Keep only the object the cameras surround. Suits walk-around captures. See [SplatAutoCrop](SplatAutoCrop.md). |
| `trainIters` | 0 | Brush iteration cap. 0 means `kDefaultTrainIters`. |
| `fps` | 0 | Media only: frames taken per second of video. 0 means `kDefaultFps`. |

## `struct JobStatus`
The live state of one build. It has **the same fields as the backend's `GET /jobs/:id`**, so local and server builds read the same way.

| Field | Meaning |
|---|---|
| `id` | Build id. |
| `status` | `queued`, `running`, `done`, `error` or `cancelled`. |
| `phase` | `extract`, `masking`, `colmap-*`, `training`, `crop`, `normalize` or `done`. |
| `detail` | Free text, for example `"Iteration 1200/7000"`. |
| `error` | Error message when `status` is `error`. |
| `progress` | 0…1. |
| `hasResult` | Whether a `.ply` was produced. |

### `bool isFinished() const`
Returns true when `status` is `done`, `error` or `cancelled`.
