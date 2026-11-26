# `metrics/FrameMetrics.h` / `FrameMetrics.cpp`

The engine's **frame timing and frame-drop logger**. `Viewport::paintGL` drives it once per frame. It measures:

- the **frame interval**, from the start of one frame to the start of the next, which is what the user sees;
- **CPU time** of three sections: `Scene` (splat and crop-box draw calls), `Overlay` (the ImGui frame) and `Commit` (a finished drag or nudge being applied);
- **GPU time** of the scene draw, using `GL_TIME_ELAPSED` timer queries that are read back a few frames late so they never stall.

A frame longer than **1.5 × the display refresh** counts as a **drop**.

Frames are grouped into **interaction sessions** (a gizmo drag, a nudge, a camera orbit or pan). When a session ends, its summary is written to the Console and to a session CSV. **Recordings** (`StartRecording`/`StopRecording`) log every frame to a CSV and write a JSON summary that the metrics dashboard's *Engine* tab reads ([frontend/metrics-dashboard](../../frontend/metrics-dashboard/README.md)).

## Types

| Type | Purpose |
|---|---|
| `Activity` | `Idle`, `GizmoTranslate`/`Rotate`/`Scale`, `Nudge`, `CameraOrbit`, `CameraPan`. A session is a run of frames with the same activity. |
| `Target` | What the interaction moves: `None`, `Model`, `CropBox`, `CropBoxContents` (the crop box carrying selected splats). |
| `Section` | Timed CPU sections: `Scene`, `Overlay`, `Commit`. |
| `FrameRecord` | One finished frame: id, start time, `intervalMs`, `expectedMs`, CPU time per section, `gpuSceneMs` (−1 until the query result arrives), missed vsyncs, dropped flag, activity, target, splat count and model count. |
| `LiveStats` | Rolling stats over the last second for the overlay: average fps and frame time, worst frame, average CPU and GPU scene time, total drops, drops in the last second. |
| `RecordingSummary` | Results of a finished recording: id, file paths, duration, frames, average fps, **1% low fps**, slowest second, p50/p95/p99/max frame time, drops, missed vsyncs, pauses, splat min/max/average, maximum models, refresh rate, average CPU and GPU time. |
| `RecordingLive` | Running totals for the "REC" indicator. |
| `StartResult` | `Started`, `AlreadyRecording`, `StillSaving`, `NoOutput`, `FileError`. |
| `ScopedCommit` | RAII timer for the `Commit` section. |

## Tunables (anonymous namespace)

| Constant | Value | Meaning |
|---|---|---|
| `kDropFactor` | 1.5 | A frame longer than this many refreshes is a drop. |
| `kIdleStallMs` | 1000 | An idle frame longer than this is the window being hidden, not a drop. |
| `kProcessDelay` | 4 | Frames are processed this many frames late, so their GPU time has arrived. |
| `kDropLogInterval` | 0.5 s | At most one drop line every 0.5 s. The rest are counted. |
| `kMinLoggedFrames` | 3 | Shorter sessions with no drops are clicks and are not logged. |
| `kKeepRuns` / `kKeepRecordings` | 20 / 50 | How many old log runs and recordings are kept. |
| `kMaxSessionSamples` / `kMaxRecordingSamples` | 100k / 600k | Caps on stored intervals used for percentiles. |
| `kHistorySize` | 256 | Size of the ring buffer of recent frames. |
| `kQueryCount` | 6 | Size of the ring of GPU timer queries. |

## Helper functions (anonymous namespace)

- **`RecordingSortKey(id)`**: splits `rec_yyyyMMdd_HHmmss[_n]` into (timestamp, n), so `_10` sorts after `_2`. An id with no suffix counts as n = 1.
- **`PruneRecordings(folder, keep)`**: groups `rec_*.csv`, `.json` and `.json.tmp` files by id, sorts them newest first and deletes every group after the first `keep`. Each id's files are deleted together, so no half-pairs are left behind.
- **`JsonString(s)`**: quotes a string for JSON, escaping `"` and `\` and replacing control characters with spaces.
- **`Format(fmt, ...)`**: `vsnprintf` into a 1 KB buffer, returned as a `std::string`.
- **`LogInfo` / `LogWarning`**: `qInfo()`/`qWarning()` without quotes. The Console panel captures these.
- **`Percentile(sorted, p)`**: nearest-rank percentile, `sorted[ceil(p·n) − 1]`.
- **`MsBetween(a, b)`**: milliseconds between two `steady_clock` time points.

## Lifecycle

### `FrameMetrics()` / `~FrameMetrics()`
The constructor records the epoch (time zero). The destructor only closes an open session. GL objects need a current context, so releasing them is `Shutdown()`'s job.

### `void Init(const std::string& logDir)`
Needs a current GL context. It runs once:
1. Turns on GPU timing if `GLEW_VERSION_3_3 || GLEW_ARB_timer_query`, and generates 6 queries. Otherwise it logs a warning.
2. Saves `GL_RENDERER`, the GPU name used in recording summaries.
3. If `logDir` is not empty: creates the folder and prunes old `metrics_*_sessions.csv` and `_frames.csv` files down to 20 runs (using `AssetPaths::PruneOldFiles`). It then opens `metrics_<stamp>_sessions.csv` and `_frames.csv` and writes their header rows. Finally it creates `recordings/` and prunes it down to 50 recordings.

### `void Shutdown()`
Needs a current GL context. Calls `glFinish` so the last GPU results land, polls the queries, processes every waiting frame (`flushAll`), closes the session, finishes any recording, deletes the queries and closes the CSVs.

## Per-frame API (called from `paintGL`)

### `void BeginFrame(double refreshHz)`
1. If last frame's record is still open, `FinalizePending(now)` closes it, because its interval is now known.
2. `PollGpuQueries()`, then `ProcessReadyFrames(false)`, then `UpdateLive()`.
3. Starts a new pending `FrameRecord` with `expectedMs = 1000 / refreshHz`. If the refresh rate is 1 Hz or less, 60 Hz is assumed.

### `void FinalizePending(double nowSeconds)` *(private)*
Sets `intervalMs`. If the frame is not an idle stall and `interval > 1.5 × expected`, it marks the frame **dropped** with `missedVsyncs = max(1, round(interval/expected) − 1)` and increments the total drop count. It then stores the frame in the history ring and advances `m_finalizedEnd`.

### `BeginSection(Section)` / `EndSection(Section)`
Saves the start time, then adds the elapsed milliseconds to `m_pending.cpuMs[section]`. The sums add up, so a section may run more than once per frame. `EndSection` without a matching begin is ignored.

### `BeginGpuScene()` / `EndGpuScene()`
Brackets the scene draw with `glBeginQuery`/`glEndQuery(GL_TIME_ELAPSED)` using the next query in the ring. If that query is **still in flight**, because the GPU is more than 6 frames behind, this frame is not timed rather than waiting. On end, it marks the query in flight, tags it with the frame id and advances the ring. These calls must not be nested.

### `void PollGpuQueries()` *(private)*
For each query in flight whose `GL_QUERY_RESULT_AVAILABLE` is set, it reads the nanosecond result and stores it as `gpuSceneMs` on the matching history frame. It first checks the frame id still matches and the frame has been finalized.

### `void SetActivity(Activity, Target)`
Sets the pending frame's activity and target. **Special case:** the frame that commits a drag reports `Idle` (the drag has just ended), but if a commit was timed this frame, it keeps the previous activity so the hitch counts against the drag. The latest activity and target are always saved as `m_lastActive`/`m_lastTarget`.

### `void EndFrame(size_t splatCount, size_t modelCount)`
Saves the scene size on the pending frame.

### `ScopedCommit`
The constructor saves the start time. The destructor:
- returns early if no frame has started yet;
- if the Overlay section is open, moves its start forward by the commit duration, so the commit is not counted twice;
- if the commit happens between frames (for example, a nudge key release), gives the pending frame the last real activity;
- adds `max(ms, 0.001)` to the `Commit` section, because zero would read as "no commit";
- logs `"[Metrics] <activity> (<target>) commit took X ms"`, as a **warning** if the commit took longer than one frame.

## Processing pipeline (private)

### `ProcessReadyFrames(bool flushAll)`
Processes finalized frames in order, `kProcessDelay` (4) frames behind the newest, or with no delay when `flushAll` is set. If the next frame's GPU result is still pending, it waits for it (up to the size of the query ring) and the later frames wait too, so order is kept. Frames that fell out of the history ring are skipped.

### `GpuResultPending(frameId)`
Returns true if any query in flight is tagged with this frame.

### `ProcessFrame(const FrameRecord&)`
- An **Idle** frame closes the open session.
- Otherwise, if the activity or target changed, it closes the session and opens a new one. It then adds the interval, drops, CPU and GPU sums and maxima, commit time, splat count and end time to the session, and calls `LogDrop` if the frame dropped.
- It writes the frame to the frames CSV if the frame was not idle or was dropped.
- It always calls `RecordFrame()`.

### `OpenSession(frame)` / `CloseSession()`
`OpenSession` resets the session with the frame's activity, target and start time. `CloseSession` flushes the frames CSV (once per interaction, so a crash loses at most one interaction) and skips sessions shorter than 3 frames with no drops. Otherwise it sorts the intervals and computes average fps and frame time, p50/p95/p99/max, and CPU overlay and GPU averages. It writes one Console line (a **warning** if the session had drops) and one session CSV row.

### `LogDrop(frame)`
Rate-limited to one line every 0.5 s. Suppressed drops are counted and mentioned in the next line. It names the **likely culprit** as the largest of CPU scene, ImGui overlay, drag commit and GPU scene. If even the largest covers less than half the frame, it reports *"outside the timed sections (events / swap / driver)"*.

### `WriteFrameCsv(frame)`
Writes one row: `frame,start_s,activity,target,interval_ms,expected_ms,missed_vsyncs,dropped,cpu_scene_ms,cpu_overlay_ms,commit_ms,gpu_scene_ms,splats,models`.

### `UpdateLive()`
Walks the history ring backwards from the newest frame and covers one second. It fills `m_live` with average fps and frame time, the worst frame, average CPU and GPU scene time, and drops in the last second.

## Recording

### `StartResult StartRecording()`
Refuses if a recording is running (`AlreadyRecording`), one is still saving (`StillSaving`) or there is no output folder (`NoOutput`). It picks an id `rec_yyyyMMdd_HHmmss`, adding `_2`, `_3` and so on if that file already exists. It opens the CSV with columns `t_s,frame_ms,fps,dropped,missed_vsyncs,splats,models,activity,cpu_scene_ms,gpu_scene_ms` (returning `FileError` if it cannot), sets `m_recStartId` to the next frame id, saves the ISO start time and resets every accumulator.

### `void StopRecording()`
Sets `m_recEndId` to the next frame id. Frames are processed late, so the summary is written once processing passes that frame. If processing has already passed it, the summary is written immediately.

### `bool IsRecording()` / `bool IsSavingRecording()`
`IsRecording` is true while recording and not stopped. `IsSavingRecording` is true after stop until the summary is written.

### `RecordingLive LiveRecording() const`
Returns elapsed wall time, frame count, drops and average fps so far.

### `RecordFrame(frame)` *(private)*
For frames inside `[start, end)`:
- An **idle frame longer than 1 s** counts as a *pause*. It is counted but left out of the averages.
- Other frames add to the interval list and sums, CPU and GPU sums, and drops.
- Per-second buckets (`RecordingSecond`, capped at 86,400 s) collect frames, interval sum, worst frame, drops, and maximum splats and models.
- Splat min, max and sum and maximum models are tracked, and one CSV row is written.

When the frame just before `m_recEndId` has been processed, it calls `FinishRecording()`.

### `FinishRecording()` *(private)*
Closes the CSV and builds a `RecordingSummary`:
- **1% low fps** is `1000 / mean(slowest 1% of frame times)`.
- **Minimum second fps** is the slowest second, ignoring seconds with under 500 ms of frames (partial seconds and pauses).

It writes `rec_<id>.json` (`version`, `id`, `startedAt`, `host`, `gpu`, `csvFile`, the summary numbers and a `seconds[]` array) to a **`.tmp` file first and then renames it**, so the dashboard never reads half a file. It logs the result, frees the sample buffers and calls `onRecordingFinished(summary)`. That callback runs inside `paintGL`, so UI work in it should be deferred.

## Other accessors
- `Live()`: the current `LiveStats`.
- `CurrentActivity()`: the activity from the last `SetActivity` call.
- `CopyIntervalHistory(out)`: fills `out` with 256 floats, oldest first and zero-padded at the front, for the overlay's frame-time plot.
- `SessionLogPath()`, `RecordingDir()`.
- `ActivityName(a)` / `TargetName(t)`: display strings used in logs and CSVs.
