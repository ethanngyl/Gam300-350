/*!************************************************************************
\file FrameMetrics.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
Declares FrameMetrics, the engine's frame timing and frame drop logger.
Each frame records the frame interval, CPU time of the scene draw, overlay
and drag commit, and GPU time of the scene draw (timer queries, read back a
few frames late so they never stall). Frames longer than 1.5 display
refreshes count as drops.

Frames are grouped into interaction sessions (gizmo drag, nudge, camera
orbit/pan). When a session ends its summary (fps, frame time percentiles,
drops, CPU/GPU split) goes to the Console, and to a CSV under the user data
folder. Individual drops during an interaction are logged as they happen
(rate limited), with the section that took the time.

Recordings (StartRecording / StopRecording) log every frame between start
and stop -- frame time, fps, drop, splat and model count -- to a CSV, and on
stop write a JSON summary (average fps, 1% low, percentiles, drops, splat
range, one entry per second) that the metrics dashboard's Engine tab reads.
**************************************************************************/
#pragma once

#include <array>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <functional>
#include <string>
#include <vector>

class FrameMetrics {
public:
    // What the user is doing during a frame. Sessions are runs of the same activity.
    enum class Activity : std::uint8_t {
        Idle,
        GizmoTranslate,
        GizmoRotate,
        GizmoScale,
        Nudge,
        CameraOrbit,
        CameraPan,
        Count
    };

    // What an interaction is moving.
    enum class Target : std::uint8_t {
        None,
        Model,
        CropBox,
        CropBoxContents, // crop box carrying the confirmed splat selection
        Count
    };

    // Timed CPU sections of a frame.
    enum class Section : std::uint8_t {
        Scene,   // splat + crop box draw calls (includes sort pickup and buffer uploads)
        Overlay, // ImGui frame: gizmo, tool buttons, stats
        Commit,  // a finished drag / nudge being reported to the editor (undo push, splat bake)
        Count
    };

    // One finished frame.
    struct FrameRecord {
        std::uint64_t id = 0;
        double startSeconds = 0.0;   // since FrameMetrics was created
        float intervalMs = 0.0f;     // start of this frame to start of the next (what the user sees)
        float expectedMs = 0.0f;     // one display refresh
        std::array<float, static_cast<std::size_t>(Section::Count)> cpuMs{};
        float gpuSceneMs = -1.0f;    // -1 until (or unless) the timer query result arrives
        int missedVsyncs = 0;
        bool dropped = false;
        Activity activity = Activity::Idle;
        Target target = Target::None;
        std::size_t splatCount = 0;
        std::size_t modelCount = 0;
    };

    // Rolling stats for the overlay.
    struct LiveStats {
        float avgFps = 0.0f;         // over the last second
        float avgFrameMs = 0.0f;
        float worstFrameMs = 0.0f;
        float avgCpuSceneMs = 0.0f;
        float avgGpuSceneMs = -1.0f;
        float expectedMs = 0.0f;
        std::uint64_t totalDrops = 0;
        int dropsLastSecond = 0;
    };

    // Results of a finished recording (see StartRecording).
    struct RecordingSummary {
        std::string id;                  // rec_YYYYMMDD_HHMMSS, also the file name stem
        std::string csvPath;             // every frame
        std::string jsonPath;            // this summary + one entry per second, read by the metrics dashboard
        double durationSec = 0.0;
        std::uint64_t frames = 0;        // frames counted in the averages (pauses excluded)
        float avgFps = 0.0f;             // frames / time they took
        float onePercentLowFps = 0.0f;   // average fps of the slowest 1% of frames
        float minSecondFps = 0.0f;       // slowest whole second
        float avgFrameMs = 0.0f;
        float p50FrameMs = 0.0f;
        float p95FrameMs = 0.0f;
        float p99FrameMs = 0.0f;
        float maxFrameMs = 0.0f;
        std::uint64_t drops = 0;
        std::uint64_t missedVsyncs = 0;
        std::uint64_t pauses = 0;        // frames over a second (window hidden / minimised), left out of the averages
        std::size_t minSplats = 0;
        std::size_t maxSplats = 0;
        double avgSplats = 0.0;
        std::size_t maxModels = 0;
        float refreshHz = 0.0f;
        float avgCpuSceneMs = 0.0f;
        float avgGpuSceneMs = -1.0f;     // -1 if no GPU timings arrived
    };

    // Running totals of the recording in progress, for the REC indicator.
    struct RecordingLive {
        bool active = false;             // started and not yet stopped
        double elapsedSec = 0.0;         // wall clock since StartRecording
        std::uint64_t frames = 0;
        float avgFps = 0.0f;
        std::uint64_t drops = 0;
    };

    static constexpr std::size_t kHistorySize = 256;

    FrameMetrics();
    ~FrameMetrics();

    FrameMetrics(const FrameMetrics&) = delete;
    FrameMetrics& operator=(const FrameMetrics&) = delete;

    // Needs the GL context current. Creates the GPU timer queries and opens the CSV logs in logDir
    // (empty logDir disables file output).
    void Init(const std::string& logDir);
    // Needs the GL context current. Closes the open session and the logs, deletes the queries.
    void Shutdown();

    // Start of paintGL. refreshHz is the display's refresh rate (0 = unknown, 60 is assumed).
    void BeginFrame(double refreshHz);
    void BeginSection(Section section);
    void EndSection(Section section);
    // Bracket the scene draw calls to time them on the GPU. Must not be nested.
    void BeginGpuScene();
    void EndGpuScene();
    // What this frame is doing. The frame that commits a drag keeps the drag's activity,
    // so its hitch is counted against the drag.
    void SetActivity(Activity activity, Target target);
    // End of paintGL.
    void EndFrame(std::size_t splatCount, std::size_t modelCount);

    // Times a drag / nudge commit. May be called inside or outside paintGL.
    class ScopedCommit {
    public:
        explicit ScopedCommit(FrameMetrics& metrics);
        ~ScopedCommit();
        ScopedCommit(const ScopedCommit&) = delete;
        ScopedCommit& operator=(const ScopedCommit&) = delete;
    private:
        FrameMetrics& m_metrics;
        std::chrono::steady_clock::time_point m_start;
    };

    const LiveStats& Live() const { return m_live; }
    // Activity of the most recent SetActivity call (last frame's, when read mid-frame).
    Activity CurrentActivity() const { return m_lastActive; }
    // Frame intervals of the last kHistorySize frames, oldest first, for a plot.
    void CopyIntervalHistory(std::vector<float>& out) const;
    const std::string& SessionLogPath() const { return m_sessionLogPath; }

    // Recording: while on, every frame (frame time, fps, drop, splat and model count) is written to
    // <logDir>/recordings/rec_<time>.csv. Stopping writes a .json summary next to it once the last
    // recorded frame has been processed (a few frames later), then calls onRecordingFinished.
    // Returns false if already recording or file output is off.
    bool StartRecording();
    void StopRecording();
    bool IsRecording() const { return m_recording && m_recEndId == kNoEnd; }
    RecordingLive LiveRecording() const;
    // Folder the recordings are written to (empty if file output is off).
    const std::string& RecordingDir() const { return m_recordingDir; }
    // Called from paintGL when a stopped recording's summary is written. Defer any UI work (dialogs).
    std::function<void(const RecordingSummary&)> onRecordingFinished;

    static const char* ActivityName(Activity activity);
    static const char* TargetName(Target target);

private:
    using Clock = std::chrono::steady_clock;

    struct Session {
        Activity activity = Activity::Idle;
        Target target = Target::None;
        double startSeconds = 0.0;
        double endSeconds = 0.0;
        std::vector<float> intervals;
        std::uint64_t drops = 0;
        std::uint64_t missedVsyncs = 0;
        double cpuSceneSum = 0.0;
        float cpuSceneMax = 0.0f;
        double cpuOverlaySum = 0.0;
        float cpuOverlayMax = 0.0f;
        float commitMs = 0.0f;
        double gpuSceneSum = 0.0;
        float gpuSceneMax = 0.0f;
        std::size_t gpuSamples = 0;
        std::size_t splatCount = 0;
        float expectedMs = 0.0f;
    };

    // Moves the finished pending frame into the history.
    void FinalizePending(double nowSeconds);
    // Reads back any GPU timer results that are ready.
    void PollGpuQueries();
    // Processes frames kProcessDelay behind the newest, once their GPU time has had time to arrive.
    // Waits longer (up to kQueryCount frames) for a frame whose GPU result is still in flight.
    void ProcessReadyFrames(bool flushAll);
    bool GpuResultPending(std::uint64_t frameId) const;
    void ProcessFrame(const FrameRecord& frame);
    void UpdateLive();
    void OpenSession(const FrameRecord& frame);
    void CloseSession();
    void LogDrop(const FrameRecord& frame);
    void WriteFrameCsv(const FrameRecord& frame);
    double SecondsSinceStart(Clock::time_point t) const;
    // Adds a processed frame to the recording if it falls inside it, and finishes a stopped one.
    void RecordFrame(const FrameRecord& frame);
    void FinishRecording();

    // One second of a recording, for the dashboard's charts.
    struct RecordingSecond {
        std::uint32_t frames = 0;
        double intervalSum = 0.0;
        float maxFrameMs = 0.0f;
        std::uint32_t drops = 0;
        std::size_t splats = 0;
        std::size_t models = 0;
    };

    static constexpr std::uint64_t kNoEnd = UINT64_MAX;
    bool m_recording = false;
    std::uint64_t m_recStartId = 0;      // first frame id in the recording
    std::uint64_t m_recEndId = kNoEnd;   // one past the last frame id, set by StopRecording
    Clock::time_point m_recWallStart;
    std::string m_recStartedAt;          // ISO 8601 local time
    std::string m_recId;
    bool m_recHaveFirst = false;
    double m_recFirstSeconds = 0.0;
    double m_recLastEndSeconds = 0.0;
    std::vector<float> m_recIntervals;
    std::uint64_t m_recFrames = 0;       // non-pause frames
    double m_recIntervalSum = 0.0;
    double m_recCpuSceneSum = 0.0;
    double m_recGpuSceneSum = 0.0;
    std::uint64_t m_recGpuSamples = 0;
    std::uint64_t m_recDrops = 0;
    std::uint64_t m_recMissedVsyncs = 0;
    std::uint64_t m_recPauses = 0;
    std::uint64_t m_recSplatFrames = 0;
    double m_recSplatSum = 0.0;
    std::size_t m_recMinSplats = 0;
    std::size_t m_recMaxSplats = 0;
    std::size_t m_recMaxModels = 0;
    float m_recExpectedMs = 0.0f;
    std::vector<RecordingSecond> m_recSeconds;
    std::ofstream m_recCsv;
    std::string m_recCsvPath;

    std::string m_recordingDir;
    std::string m_gpuName;               // GL_RENDERER, saved in each recording's summary

    Clock::time_point m_epoch;
    std::uint64_t m_nextId = 0;          // id the next BeginFrame gets
    std::uint64_t m_finalizedEnd = 0;    // frames [0, m_finalizedEnd) have their full interval
    std::uint64_t m_nextToProcess = 0;   // next finalized frame to feed the sessions / logs
    FrameRecord m_pending;
    bool m_pendingOpen = false;          // BeginFrame called, interval not known yet
    std::array<Clock::time_point, static_cast<std::size_t>(Section::Count)> m_sectionStart{};
    std::array<bool, static_cast<std::size_t>(Section::Count)> m_sectionOpen{};
    // Activity of the last SetActivity call, so a commit frame can keep the drag's activity.
    Activity m_lastActive = Activity::Idle;
    Target m_lastTarget = Target::None;

    std::array<FrameRecord, kHistorySize> m_history{};

    // GPU timer queries, a ring so results are read back several frames late without stalling.
    static constexpr std::size_t kQueryCount = 6;
    std::array<unsigned int, kQueryCount> m_queries{};
    std::array<std::uint64_t, kQueryCount> m_queryFrame{};
    std::array<bool, kQueryCount> m_queryInFlight{};
    std::size_t m_queryNext = 0;
    bool m_gpuTimingAvailable = false;
    bool m_gpuQueryActive = false;

    Session m_session;
    bool m_sessionOpen = false;
    double m_lastDropLogSeconds = -1.0e9;
    int m_suppressedDropLogs = 0;

    LiveStats m_live;

    std::ofstream m_sessionCsv;
    std::ofstream m_frameCsv;
    std::string m_sessionLogPath;
    bool m_initialized = false;
};
