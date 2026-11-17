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
**************************************************************************/
#pragma once

#include <array>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <fstream>
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
    void ProcessReadyFrames(bool flushAll);
    void ProcessFrame(const FrameRecord& frame);
    void UpdateLive();
    void OpenSession(const FrameRecord& frame);
    void CloseSession();
    void LogDrop(const FrameRecord& frame);
    void WriteFrameCsv(const FrameRecord& frame);
    double SecondsSinceStart(Clock::time_point t) const;

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
