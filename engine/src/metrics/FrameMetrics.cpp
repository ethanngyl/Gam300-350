/*!************************************************************************
\file FrameMetrics.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
Implements FrameMetrics: per-frame CPU section and GPU timer query timing,
frame drop detection against the display refresh, per-interaction session
summaries, rate-limited drop logging to the Console, and CSV logs (one pair
per run, the newest kKeepRuns runs are kept) under the user data folder.
**************************************************************************/
// GLEW must come before any Qt OpenGL header, since those pull in gl.h.
#include <GL/glew.h>

#include "metrics/FrameMetrics.h"
#include "ui/AssetPaths.h"

#include <QDateTime>
#include <QDebug>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QString>
#include <QSysInfo>

#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <utility>

namespace {
    // A frame longer than this many refreshes missed at least one vsync.
    constexpr float kDropFactor = 1.5f;
    // Idle frames longer than this are the window being hidden / minimised, not a drop.
    constexpr float kIdleStallMs = 1000.0f;
    // Frames are processed this many frames late so their GPU time has arrived.
    constexpr std::uint64_t kProcessDelay = 4;
    // At most one drop line per this many seconds; the rest are counted and reported with the next one.
    constexpr double kDropLogInterval = 0.5;
    // Sessions this short with no drops are clicks, not interactions, and are not logged.
    constexpr std::size_t kMinLoggedFrames = 3;
    // Cap on per-session frame intervals kept for percentiles (~30 min at 60 Hz).
    constexpr std::size_t kMaxSessionSamples = 100000;
    // Log runs kept in the metrics folder.
    constexpr int kKeepRuns = 20;
    // Recordings kept in metrics/recordings (each is a .csv + .json pair).
    constexpr int kKeepRecordings = 50;
    // Cap on per-recording frame intervals kept for percentiles (~1 h at 144 Hz).
    constexpr std::size_t kMaxRecordingSamples = 600000;

    // Sort key for a recording id rec_<yyyyMMdd_HHmmss>[_n]: the timestamp, then n (no suffix = 1),
    // so rec_X_10 sorts after rec_X_2.
    std::pair<QString, int> RecordingSortKey(const QString& id) {
        constexpr int kStampLength = 19; // "rec_" + "yyyyMMdd_HHmmss"
        const int n = id.size() > kStampLength + 1 ? id.mid(kStampLength + 1).toInt() : 1;
        return { id.left(kStampLength), n };
    }

    // Deletes all but the newest `keep` recordings. Each one's .csv, .json and any leftover .json.tmp
    // go together, so a crash mid-recording can't leave older recordings with half a pair.
    void PruneRecordings(const QString& folder, int keep) {
        const QDir dir(folder);
        QStringList ids;
        for (const QString& name : dir.entryList({ "rec_*.csv", "rec_*.json", "rec_*.json.tmp" }, QDir::Files)) {
            const QString id = name.left(name.indexOf('.'));
            if (!ids.contains(id)) ids.append(id);
        }
        std::sort(ids.begin(), ids.end(), [](const QString& a, const QString& b) {
            return RecordingSortKey(a) > RecordingSortKey(b); // newest first
        });
        for (int i = keep; i < ids.size(); ++i) {
            for (const char* ext : { ".csv", ".json", ".json.tmp" }) QFile::remove(dir.filePath(ids[i] + ext));
        }
    }

    // Escapes a string for a JSON string literal.
    std::string JsonString(const std::string& s) {
        std::string out = "\"";
        for (const char c : s) {
            if (c == '"' || c == '\\') { out += '\\'; out += c; }
            else if (static_cast<unsigned char>(c) < 0x20) out += ' ';
            else out += c;
        }
        return out + "\"";
    }

    std::string Format(const char* fmt, ...) {
        char buffer[1024];
        va_list args;
        va_start(args, fmt);
        std::vsnprintf(buffer, sizeof(buffer), fmt, args);
        va_end(args);
        return buffer;
    }

    void LogInfo(const std::string& text) { qInfo().noquote() << QString::fromStdString(text); }
    void LogWarning(const std::string& text) { qWarning().noquote() << QString::fromStdString(text); }

    float Percentile(const std::vector<float>& sorted, float p) {
        if (sorted.empty()) return 0.0f;
        const std::size_t index = static_cast<std::size_t>(std::ceil(p * static_cast<float>(sorted.size()))) - 1;
        return sorted[std::min(index, sorted.size() - 1)];
    }

    float MsBetween(std::chrono::steady_clock::time_point a, std::chrono::steady_clock::time_point b) {
        return std::chrono::duration<float, std::milli>(b - a).count();
    }
}

FrameMetrics::FrameMetrics()
    : m_epoch(Clock::now()) {
}

FrameMetrics::~FrameMetrics() {
    // GL objects need the context, so Shutdown() is the owner's job; this only closes the files.
    if (m_sessionOpen) CloseSession();
}

const char* FrameMetrics::ActivityName(Activity activity) {
    switch (activity) {
    case Activity::Idle:           return "Idle";
    case Activity::GizmoTranslate: return "Gizmo translate";
    case Activity::GizmoRotate:    return "Gizmo rotate";
    case Activity::GizmoScale:     return "Gizmo scale";
    case Activity::Nudge:          return "Nudge";
    case Activity::CameraOrbit:    return "Camera orbit";
    case Activity::CameraPan:      return "Camera pan";
    default:                       return "?";
    }
}

const char* FrameMetrics::TargetName(Target target) {
    switch (target) {
    case Target::None:            return "-";
    case Target::Model:           return "model";
    case Target::CropBox:         return "crop box";
    case Target::CropBoxContents: return "crop box + splats";
    default:                      return "?";
    }
}

double FrameMetrics::SecondsSinceStart(Clock::time_point t) const {
    return std::chrono::duration<double>(t - m_epoch).count();
}

void FrameMetrics::Init(const std::string& logDir) {
    if (m_initialized) return;
    m_initialized = true;

    // Timer queries are core in GL 3.3; the extension covers older drivers reporting a lower version.
    m_gpuTimingAvailable = GLEW_VERSION_3_3 || GLEW_ARB_timer_query;
    if (m_gpuTimingAvailable) {
        glGenQueries(static_cast<GLsizei>(kQueryCount), m_queries.data());
    }
    else {
        LogWarning("[Metrics] GPU timer queries unavailable, GPU frame time will not be reported");
    }
    if (const GLubyte* renderer = glGetString(GL_RENDERER)) {
        m_gpuName = reinterpret_cast<const char*>(renderer);
    }

    if (logDir.empty()) return;

    const QDir dir(QString::fromStdString(logDir));
    if (!QDir().mkpath(dir.absolutePath())) {
        LogWarning("[Metrics] Could not create " + logDir + ", metrics are not written to file");
        return;
    }
    // Keep the newest kKeepRuns runs. Names sort by time (metrics_YYYYMMDD_HHMMSS_*).
    for (const char* suffix : { "_sessions.csv", "_frames.csv" }) {
        AssetPaths::PruneOldFiles(dir.absolutePath(), QString("metrics_*") + suffix, kKeepRuns);
    }

    const QString stamp = QDateTime::currentDateTime().toString("yyyyMMdd_HHmmss");
    m_sessionLogPath = dir.filePath("metrics_" + stamp + "_sessions.csv").toStdString();
    const std::string framePath = dir.filePath("metrics_" + stamp + "_frames.csv").toStdString();

    m_sessionCsv.open(m_sessionLogPath, std::ios::out | std::ios::trunc);
    m_frameCsv.open(framePath, std::ios::out | std::ios::trunc);
    if (m_sessionCsv) {
        m_sessionCsv << "start_s,duration_s,activity,target,frames,avg_fps,avg_ms,p50_ms,p95_ms,p99_ms,max_ms,"
                        "drops,missed_vsyncs,cpu_scene_avg_ms,cpu_scene_max_ms,cpu_overlay_avg_ms,cpu_overlay_max_ms,"
                        "gpu_scene_avg_ms,gpu_scene_max_ms,commit_ms,splats,refresh_ms\n";
        m_sessionCsv.flush();
    }
    if (m_frameCsv) {
        m_frameCsv << "frame,start_s,activity,target,interval_ms,expected_ms,missed_vsyncs,dropped,"
                      "cpu_scene_ms,cpu_overlay_ms,commit_ms,gpu_scene_ms,splats,models\n";
        m_frameCsv.flush();
    }
    const QString recordingDir = dir.filePath("recordings");
    if (QDir().mkpath(recordingDir)) {
        m_recordingDir = recordingDir.toStdString();
        PruneRecordings(recordingDir, kKeepRecordings);
    }
    if (m_sessionCsv && m_frameCsv) {
        LogInfo("[Metrics] Logging interaction sessions to " + m_sessionLogPath);
    }
    else {
        LogWarning("[Metrics] Could not open the metrics CSV files in " + logDir);
    }
}

void FrameMetrics::Shutdown() {
    if (!m_initialized) return;

    // The open frame never got its full interval, so it is dropped; everything before it is processed.
    // glFinish lets the last frames' GPU results land first, since the flush below doesn't wait for them.
    if (m_gpuTimingAvailable && !m_gpuQueryActive) glFinish();
    PollGpuQueries();
    ProcessReadyFrames(true);
    if (m_sessionOpen) CloseSession();
    // The open frame never finishes, so a recording still running (or waiting on it) is closed here.
    if (m_recording) FinishRecording();

    if (m_gpuTimingAvailable) {
        if (m_gpuQueryActive) glEndQuery(GL_TIME_ELAPSED);
        glDeleteQueries(static_cast<GLsizei>(kQueryCount), m_queries.data());
        m_queries.fill(0);
        m_queryInFlight.fill(false);
    }
    m_gpuQueryActive = false;
    m_sessionCsv.close();
    m_frameCsv.close();
    m_initialized = false;
}

void FrameMetrics::BeginFrame(double refreshHz) {
    const Clock::time_point now = Clock::now();
    const double nowSeconds = SecondsSinceStart(now);

    if (m_pendingOpen) {
        FinalizePending(nowSeconds);
    }
    PollGpuQueries();
    ProcessReadyFrames(false);
    UpdateLive();

    m_pending = FrameRecord{};
    m_pending.id = m_nextId++;
    m_pending.startSeconds = nowSeconds;
    m_pending.expectedMs = 1000.0f / static_cast<float>(refreshHz > 1.0 ? refreshHz : 60.0);
    m_sectionOpen.fill(false);
    m_pendingOpen = true;
}

void FrameMetrics::FinalizePending(double nowSeconds) {
    FrameRecord& frame = m_pending;
    frame.intervalMs = static_cast<float>((nowSeconds - frame.startSeconds) * 1000.0);

    const bool hiddenStall = frame.activity == Activity::Idle && frame.intervalMs > kIdleStallMs;
    if (!hiddenStall && frame.intervalMs > kDropFactor * frame.expectedMs) {
        frame.dropped = true;
        frame.missedVsyncs = std::max(1, static_cast<int>(std::lround(frame.intervalMs / frame.expectedMs)) - 1);
        ++m_live.totalDrops;
    }

    m_history[frame.id % kHistorySize] = frame;
    m_finalizedEnd = frame.id + 1;
    m_pendingOpen = false;
}

void FrameMetrics::BeginSection(Section section) {
    const auto i = static_cast<std::size_t>(section);
    m_sectionStart[i] = Clock::now();
    m_sectionOpen[i] = true;
}

void FrameMetrics::EndSection(Section section) {
    const auto i = static_cast<std::size_t>(section);
    if (!m_sectionOpen[i]) return;
    m_pending.cpuMs[i] += MsBetween(m_sectionStart[i], Clock::now());
    m_sectionOpen[i] = false;
}

void FrameMetrics::BeginGpuScene() {
    if (!m_gpuTimingAvailable || m_gpuQueryActive || !m_pendingOpen) return;
    // The GPU is still more than kQueryCount frames behind on this query: skip timing this frame
    // instead of waiting on it.
    if (m_queryInFlight[m_queryNext]) return;
    glBeginQuery(GL_TIME_ELAPSED, m_queries[m_queryNext]);
    m_gpuQueryActive = true;
}

void FrameMetrics::EndGpuScene() {
    if (!m_gpuQueryActive) return;
    glEndQuery(GL_TIME_ELAPSED);
    m_gpuQueryActive = false;
    m_queryInFlight[m_queryNext] = true;
    m_queryFrame[m_queryNext] = m_pending.id;
    m_queryNext = (m_queryNext + 1) % kQueryCount;
}

void FrameMetrics::PollGpuQueries() {
    if (!m_gpuTimingAvailable) return;
    for (std::size_t q = 0; q < kQueryCount; ++q) {
        if (!m_queryInFlight[q]) continue;
        GLint available = 0;
        glGetQueryObjectiv(m_queries[q], GL_QUERY_RESULT_AVAILABLE, &available);
        if (!available) continue;

        GLuint64 nanoseconds = 0;
        glGetQueryObjectui64v(m_queries[q], GL_QUERY_RESULT, &nanoseconds);
        m_queryInFlight[q] = false;

        FrameRecord& frame = m_history[m_queryFrame[q] % kHistorySize];
        if (frame.id == m_queryFrame[q] && m_queryFrame[q] < m_finalizedEnd) {
            frame.gpuSceneMs = static_cast<float>(static_cast<double>(nanoseconds) / 1.0e6);
        }
    }
}

void FrameMetrics::SetActivity(Activity activity, Target target) {
    // The frame that commits a drag reports Idle (the drag just ended), but its hitch belongs to the drag.
    const bool committed = m_pending.cpuMs[static_cast<std::size_t>(Section::Commit)] > 0.0f;
    if (activity == Activity::Idle && committed && m_lastActive != Activity::Idle) {
        m_pending.activity = m_lastActive;
        m_pending.target = m_lastTarget;
    }
    else {
        m_pending.activity = activity;
        m_pending.target = target;
    }
    m_lastActive = activity;
    m_lastTarget = target;
}

void FrameMetrics::EndFrame(std::size_t splatCount, std::size_t modelCount) {
    m_pending.splatCount = splatCount;
    m_pending.modelCount = modelCount;
}

FrameMetrics::ScopedCommit::ScopedCommit(FrameMetrics& metrics)
    : m_metrics(metrics), m_start(Clock::now()) {
}

FrameMetrics::ScopedCommit::~ScopedCommit() {
    const Clock::time_point end = Clock::now();
    const float ms = MsBetween(m_start, end);
    FrameMetrics& m = m_metrics;
    if (!m.m_pendingOpen && m.m_finalizedEnd == 0) return; // no frame yet

    // Keep the overlay section from also counting the commit when it runs inside it.
    const auto overlay = static_cast<std::size_t>(Section::Overlay);
    if (m.m_sectionOpen[overlay]) {
        m.m_sectionStart[overlay] += std::chrono::duration_cast<Clock::duration>(end - m_start);
    }

    // Between frames (e.g. a nudge key release) the commit lands on the frame still waiting for its
    // interval, whose activity is already set to the nudge.
    if (m.m_pending.activity == Activity::Idle && m.m_lastActive != Activity::Idle) {
        m.m_pending.activity = m.m_lastActive;
        m.m_pending.target = m.m_lastTarget;
    }
    // A zero commit would read as "no commit", so record at least a microsecond.
    m.m_pending.cpuMs[static_cast<std::size_t>(Section::Commit)] += std::max(ms, 0.001f);

    const std::string text = Format("[Metrics] %s (%s) commit took %.2f ms",
                                    ActivityName(m.m_pending.activity), TargetName(m.m_pending.target), ms);
    if (ms > m.m_pending.expectedMs) LogWarning(text + " (longer than a frame, causes a hitch on release)");
    else LogInfo(text);
}

void FrameMetrics::ProcessReadyFrames(bool flushAll) {
    const std::uint64_t delay = flushAll ? 0 : kProcessDelay;
    // Anything that fell out of the history (cannot happen at one call per frame) is skipped.
    if (m_finalizedEnd > kHistorySize && m_nextToProcess < m_finalizedEnd - kHistorySize) {
        m_nextToProcess = m_finalizedEnd - kHistorySize;
    }
    static_assert(kQueryCount >= kProcessDelay, "the GPU wait must cover at least the normal delay");
    while (m_nextToProcess + delay < m_finalizedEnd) {
        // A GPU-heavy frame's timer result can take longer than kProcessDelay frames. Wait for it, up to
        // the whole query ring: by then its slot has been reused or skipped, so it won't come in time.
        if (!flushAll && m_finalizedEnd - m_nextToProcess <= kQueryCount && GpuResultPending(m_nextToProcess)) {
            break; // frames are processed in order, so the later ones wait too
        }
        ProcessFrame(m_history[m_nextToProcess % kHistorySize]);
        ++m_nextToProcess;
    }
}

bool FrameMetrics::GpuResultPending(std::uint64_t frameId) const {
    for (std::size_t q = 0; q < kQueryCount; ++q) {
        if (m_queryInFlight[q] && m_queryFrame[q] == frameId) return true;
    }
    return false;
}

void FrameMetrics::ProcessFrame(const FrameRecord& frame) {
    if (frame.activity == Activity::Idle) {
        if (m_sessionOpen) CloseSession();
    }
    else {
        if (m_sessionOpen && (m_session.activity != frame.activity || m_session.target != frame.target)) {
            CloseSession();
        }
        if (!m_sessionOpen) OpenSession(frame);

        Session& s = m_session;
        if (s.intervals.size() < kMaxSessionSamples) s.intervals.push_back(frame.intervalMs);
        if (frame.dropped) {
            ++s.drops;
            s.missedVsyncs += static_cast<std::uint64_t>(frame.missedVsyncs);
        }
        const float scene = frame.cpuMs[static_cast<std::size_t>(Section::Scene)];
        const float overlay = frame.cpuMs[static_cast<std::size_t>(Section::Overlay)];
        s.cpuSceneSum += scene;
        s.cpuSceneMax = std::max(s.cpuSceneMax, scene);
        s.cpuOverlaySum += overlay;
        s.cpuOverlayMax = std::max(s.cpuOverlayMax, overlay);
        s.commitMs += frame.cpuMs[static_cast<std::size_t>(Section::Commit)];
        if (frame.gpuSceneMs >= 0.0f) {
            s.gpuSceneSum += frame.gpuSceneMs;
            s.gpuSceneMax = std::max(s.gpuSceneMax, frame.gpuSceneMs);
            ++s.gpuSamples;
        }
        s.splatCount = std::max(s.splatCount, frame.splatCount);
        s.expectedMs = frame.expectedMs;
        s.endSeconds = frame.startSeconds + frame.intervalMs / 1000.0;

        if (frame.dropped) LogDrop(frame);
    }

    if (frame.activity != Activity::Idle || frame.dropped) WriteFrameCsv(frame);
    RecordFrame(frame);
}

void FrameMetrics::OpenSession(const FrameRecord& frame) {
    m_session = Session{};
    m_session.activity = frame.activity;
    m_session.target = frame.target;
    m_session.startSeconds = frame.startSeconds;
    m_session.endSeconds = frame.startSeconds;
    m_sessionOpen = true;
    m_suppressedDropLogs = 0;
}

void FrameMetrics::CloseSession() {
    m_sessionOpen = false;
    // Frame rows are flushed per interaction, not per frame, so a crash loses at most the one in progress.
    if (m_frameCsv) m_frameCsv.flush();
    Session& s = m_session;
    if (s.intervals.empty()) return;
    if (s.intervals.size() < kMinLoggedFrames && s.drops == 0) return;

    std::vector<float> sorted = s.intervals;
    std::sort(sorted.begin(), sorted.end());
    double total = 0.0;
    for (float v : sorted) total += v;
    const auto frames = static_cast<double>(sorted.size());
    const float avgMs = static_cast<float>(total / frames);
    const float avgFps = total > 0.0 ? static_cast<float>(frames * 1000.0 / total) : 0.0f;
    const float p50 = Percentile(sorted, 0.50f);
    const float p95 = Percentile(sorted, 0.95f);
    const float p99 = Percentile(sorted, 0.99f);
    const float maxMs = sorted.back();
    const float cpuSceneAvg = static_cast<float>(s.cpuSceneSum / frames);
    const float cpuOverlayAvg = static_cast<float>(s.cpuOverlaySum / frames);
    const float gpuAvg = s.gpuSamples ? static_cast<float>(s.gpuSceneSum / static_cast<double>(s.gpuSamples)) : -1.0f;
    const double duration = s.endSeconds - s.startSeconds;

    std::string text = Format(
        "[Metrics] %s (%s): %.2f s, %zu frames, %.1f fps avg | frame ms avg %.2f, p50 %.2f, p95 %.2f, p99 %.2f, max %.2f"
        " | %llu drops (%llu missed vsyncs) | CPU scene avg %.2f / max %.2f ms, overlay avg %.2f ms",
        ActivityName(s.activity), TargetName(s.target), duration, sorted.size(), avgFps,
        avgMs, p50, p95, p99, maxMs,
        static_cast<unsigned long long>(s.drops), static_cast<unsigned long long>(s.missedVsyncs),
        cpuSceneAvg, s.cpuSceneMax, cpuOverlayAvg);
    if (gpuAvg >= 0.0f) text += Format(" | GPU scene avg %.2f / max %.2f ms", gpuAvg, s.gpuSceneMax);
    if (s.commitMs > 0.0f) text += Format(" | commit %.2f ms", s.commitMs);
    text += Format(" | %zu splats", s.splatCount);
    if (m_suppressedDropLogs > 0) text += Format(" | %d drop lines not shown", m_suppressedDropLogs);
    m_suppressedDropLogs = 0;

    if (s.drops > 0) LogWarning(text);
    else LogInfo(text);

    if (m_sessionCsv) {
        m_sessionCsv << Format("%.3f,%.3f,%s,%s,%zu,%.2f,%.3f,%.3f,%.3f,%.3f,%.3f,%llu,%llu,%.3f,%.3f,%.3f,%.3f,",
                               s.startSeconds, duration, ActivityName(s.activity), TargetName(s.target),
                               sorted.size(), avgFps, avgMs, p50, p95, p99, maxMs,
                               static_cast<unsigned long long>(s.drops),
                               static_cast<unsigned long long>(s.missedVsyncs),
                               cpuSceneAvg, s.cpuSceneMax, cpuOverlayAvg, s.cpuOverlayMax);
        if (gpuAvg >= 0.0f) m_sessionCsv << Format("%.3f,%.3f,", gpuAvg, s.gpuSceneMax);
        else m_sessionCsv << ",,";
        m_sessionCsv << Format("%.3f,%zu,%.3f\n", s.commitMs, s.splatCount, s.expectedMs);
        m_sessionCsv.flush();
    }
}

void FrameMetrics::LogDrop(const FrameRecord& frame) {
    if (frame.startSeconds - m_lastDropLogSeconds < kDropLogInterval) {
        ++m_suppressedDropLogs;
        return;
    }
    m_lastDropLogSeconds = frame.startSeconds;

    const float scene = frame.cpuMs[static_cast<std::size_t>(Section::Scene)];
    const float overlay = frame.cpuMs[static_cast<std::size_t>(Section::Overlay)];
    const float commit = frame.cpuMs[static_cast<std::size_t>(Section::Commit)];
    const float gpu = frame.gpuSceneMs;

    // Name the biggest measured cost. If the measured sections cover under half the frame, the time went
    // somewhere unmeasured: event handling between frames, the buffer swap, or the driver.
    const char* culprit = "CPU scene draw";
    float biggest = scene;
    if (overlay > biggest) { biggest = overlay; culprit = "ImGui overlay"; }
    if (commit > biggest) { biggest = commit; culprit = "drag commit"; }
    if (gpu > biggest) { biggest = gpu; culprit = "GPU scene draw"; }
    if (biggest < 0.5f * frame.intervalMs) culprit = "outside the timed sections (events / swap / driver)";

    std::string text = Format("[Metrics] Frame drop during %s (%s): %.2f ms, %d missed vsync%s"
                              " | CPU scene %.2f ms, overlay %.2f ms",
                              ActivityName(frame.activity), TargetName(frame.target), frame.intervalMs,
                              frame.missedVsyncs, frame.missedVsyncs == 1 ? "" : "s", scene, overlay);
    if (commit > 0.0f) text += Format(", commit %.2f ms", commit);
    text += gpu >= 0.0f ? Format(" | GPU scene %.2f ms", gpu) : std::string(" | GPU scene n/a");
    text += Format(" | likely: %s", culprit);
    if (m_suppressedDropLogs > 0) {
        text += Format(" (+%d earlier drops not shown)", m_suppressedDropLogs);
        m_suppressedDropLogs = 0;
    }
    LogWarning(text);
}

void FrameMetrics::WriteFrameCsv(const FrameRecord& frame) {
    if (!m_frameCsv) return;
    m_frameCsv << Format("%llu,%.4f,%s,%s,%.3f,%.3f,%d,%d,%.3f,%.3f,%.3f,",
                         static_cast<unsigned long long>(frame.id), frame.startSeconds,
                         ActivityName(frame.activity), TargetName(frame.target),
                         frame.intervalMs, frame.expectedMs, frame.missedVsyncs, frame.dropped ? 1 : 0,
                         frame.cpuMs[static_cast<std::size_t>(Section::Scene)],
                         frame.cpuMs[static_cast<std::size_t>(Section::Overlay)],
                         frame.cpuMs[static_cast<std::size_t>(Section::Commit)]);
    if (frame.gpuSceneMs >= 0.0f) m_frameCsv << Format("%.3f", frame.gpuSceneMs);
    m_frameCsv << Format(",%zu,%zu\n", frame.splatCount, frame.modelCount);
}

void FrameMetrics::UpdateLive() {
    if (m_finalizedEnd == 0) return;
    const FrameRecord& newest = m_history[(m_finalizedEnd - 1) % kHistorySize];
    const double windowStart = newest.startSeconds - 1.0;
    const std::uint64_t oldest = m_finalizedEnd > kHistorySize ? m_finalizedEnd - kHistorySize : 0;

    double intervalSum = 0.0, sceneSum = 0.0, gpuSum = 0.0;
    float worst = 0.0f;
    int frames = 0, gpuFrames = 0, drops = 0;
    for (std::uint64_t id = m_finalizedEnd; id-- > oldest;) {
        const FrameRecord& f = m_history[id % kHistorySize];
        if (f.startSeconds < windowStart) break;
        intervalSum += f.intervalMs;
        sceneSum += f.cpuMs[static_cast<std::size_t>(Section::Scene)];
        worst = std::max(worst, f.intervalMs);
        if (f.gpuSceneMs >= 0.0f) { gpuSum += f.gpuSceneMs; ++gpuFrames; }
        if (f.dropped) ++drops;
        ++frames;
    }
    if (frames == 0) return;

    m_live.avgFrameMs = static_cast<float>(intervalSum / frames);
    m_live.avgFps = intervalSum > 0.0 ? static_cast<float>(frames * 1000.0 / intervalSum) : 0.0f;
    m_live.worstFrameMs = worst;
    m_live.avgCpuSceneMs = static_cast<float>(sceneSum / frames);
    m_live.avgGpuSceneMs = gpuFrames ? static_cast<float>(gpuSum / gpuFrames) : -1.0f;
    m_live.expectedMs = newest.expectedMs;
    m_live.dropsLastSecond = drops;
}

FrameMetrics::StartResult FrameMetrics::StartRecording() {
    if (IsRecording()) return StartResult::AlreadyRecording;
    if (IsSavingRecording()) return StartResult::StillSaving;
    if (m_recordingDir.empty()) return StartResult::NoOutput;

    const QDir dir(QString::fromStdString(m_recordingDir));
    const QDateTime now = QDateTime::currentDateTime();
    // Two recordings in the same second get a suffix instead of overwriting each other.
    QString id = "rec_" + now.toString("yyyyMMdd_HHmmss");
    for (int n = 2; QFileInfo::exists(dir.filePath(id + ".csv")); ++n) {
        id = "rec_" + now.toString("yyyyMMdd_HHmmss") + QString("_%1").arg(n);
    }
    m_recId = id.toStdString();
    m_recCsvPath = dir.filePath(id + ".csv").toStdString();
    m_recCsv.open(m_recCsvPath, std::ios::out | std::ios::trunc);
    if (!m_recCsv) {
        LogWarning("[Metrics] Could not create " + m_recCsvPath + ", recording not started");
        return StartResult::FileError;
    }
    m_recCsv << "t_s,frame_ms,fps,dropped,missed_vsyncs,splats,models,activity,cpu_scene_ms,gpu_scene_ms\n";

    m_recording = true;
    m_recStartId = m_nextId; // the next frame to begin is the first one recorded
    m_recEndId = kNoEnd;
    m_recWallStart = Clock::now();
    m_recStartedAt = now.toOffsetFromUtc(now.offsetFromUtc()).toString(Qt::ISODate).toStdString();
    m_recHaveFirst = false;
    m_recFirstSeconds = 0.0;
    m_recLastEndSeconds = 0.0;
    m_recIntervals.clear();
    m_recFrames = 0;
    m_recIntervalSum = 0.0;
    m_recCpuSceneSum = 0.0;
    m_recGpuSceneSum = 0.0;
    m_recGpuSamples = 0;
    m_recDrops = 0;
    m_recMissedVsyncs = 0;
    m_recPauses = 0;
    m_recSplatFrames = 0;
    m_recSplatSum = 0.0;
    m_recMinSplats = 0;
    m_recMaxSplats = 0;
    m_recMaxModels = 0;
    m_recExpectedMs = 0.0f;
    m_recSeconds.clear();

    LogInfo("[Metrics] Recording started: " + m_recCsvPath);
    return StartResult::Started;
}

void FrameMetrics::StopRecording() {
    if (!IsRecording()) return;
    // Frames up to the last one begun are part of the recording. They are processed a few frames
    // late (GPU timings), so the summary is written once processing gets past them.
    m_recEndId = m_nextId;
    if (m_nextToProcess >= m_recEndId) FinishRecording();
}

FrameMetrics::RecordingLive FrameMetrics::LiveRecording() const {
    RecordingLive live;
    live.active = IsRecording();
    if (!m_recording) return live;
    live.elapsedSec = std::chrono::duration<double>(Clock::now() - m_recWallStart).count();
    live.frames = m_recFrames;
    live.drops = m_recDrops;
    live.avgFps = m_recIntervalSum > 0.0 ? static_cast<float>(static_cast<double>(m_recFrames) * 1000.0 / m_recIntervalSum) : 0.0f;
    return live;
}

void FrameMetrics::RecordFrame(const FrameRecord& frame) {
    if (!m_recording) return;

    if (frame.id >= m_recStartId && frame.id < m_recEndId) {
        if (!m_recHaveFirst) {
            m_recHaveFirst = true;
            m_recFirstSeconds = frame.startSeconds;
        }
        const double t = frame.startSeconds - m_recFirstSeconds;
        m_recLastEndSeconds = frame.startSeconds + frame.intervalMs / 1000.0;
        const float scene = frame.cpuMs[static_cast<std::size_t>(Section::Scene)];
        // An idle frame over a second is the window being hidden or the app waiting for input:
        // counted, but left out of the averages so it doesn't swamp them. A long frame during an
        // interaction is a real hitch and stays in (the same rule FinalizePending uses).
        const bool pause = frame.activity == Activity::Idle && frame.intervalMs > kIdleStallMs;

        // One bucket per second for the dashboard's charts (capped at a day).
        const auto second = static_cast<std::size_t>(std::max(t, 0.0));
        if (second < 86400 && second >= m_recSeconds.size()) m_recSeconds.resize(second + 1);
        RecordingSecond* bucket = second < m_recSeconds.size() ? &m_recSeconds[second] : nullptr;

        if (pause) {
            ++m_recPauses;
        }
        else {
            ++m_recFrames;
            if (m_recIntervals.size() < kMaxRecordingSamples) m_recIntervals.push_back(frame.intervalMs);
            m_recIntervalSum += frame.intervalMs;
            m_recCpuSceneSum += scene;
            if (frame.gpuSceneMs >= 0.0f) {
                m_recGpuSceneSum += frame.gpuSceneMs;
                ++m_recGpuSamples;
            }
            if (frame.dropped) {
                ++m_recDrops;
                m_recMissedVsyncs += static_cast<std::uint64_t>(frame.missedVsyncs);
            }
            if (bucket) {
                ++bucket->frames;
                bucket->intervalSum += frame.intervalMs;
                bucket->maxFrameMs = std::max(bucket->maxFrameMs, frame.intervalMs);
                if (frame.dropped) ++bucket->drops;
            }
        }
        if (bucket) {
            bucket->splats = std::max(bucket->splats, frame.splatCount);
            bucket->models = std::max(bucket->models, frame.modelCount);
        }

        if (m_recSplatFrames == 0) {
            m_recMinSplats = frame.splatCount;
            m_recMaxSplats = frame.splatCount;
        }
        m_recMinSplats = std::min(m_recMinSplats, frame.splatCount);
        m_recMaxSplats = std::max(m_recMaxSplats, frame.splatCount);
        m_recSplatSum += static_cast<double>(frame.splatCount);
        ++m_recSplatFrames;
        m_recMaxModels = std::max(m_recMaxModels, frame.modelCount);
        m_recExpectedMs = frame.expectedMs;

        if (m_recCsv) {
            const float fps = frame.intervalMs > 0.0f ? 1000.0f / frame.intervalMs : 0.0f;
            m_recCsv << Format("%.4f,%.3f,%.1f,%d,%d,%zu,%zu,%s,%.3f,", t, frame.intervalMs, fps,
                               frame.dropped ? 1 : 0, frame.missedVsyncs, frame.splatCount, frame.modelCount,
                               ActivityName(frame.activity), scene);
            if (frame.gpuSceneMs >= 0.0f) m_recCsv << Format("%.3f", frame.gpuSceneMs);
            m_recCsv << '\n';
        }
    }

    if (m_recEndId != kNoEnd && frame.id + 1 >= m_recEndId) FinishRecording();
}

void FrameMetrics::FinishRecording() {
    if (!m_recording) return;
    m_recording = false;
    m_recEndId = kNoEnd;
    m_recCsv.close();

    RecordingSummary s;
    s.id = m_recId;
    s.csvPath = m_recCsvPath;
    s.jsonPath = QDir(QString::fromStdString(m_recordingDir)).filePath(QString::fromStdString(m_recId) + ".json").toStdString();
    s.durationSec = m_recHaveFirst ? m_recLastEndSeconds - m_recFirstSeconds : 0.0;
    s.frames = m_recFrames;
    s.drops = m_recDrops;
    s.missedVsyncs = m_recMissedVsyncs;
    s.pauses = m_recPauses;
    s.minSplats = m_recMinSplats;
    s.maxSplats = m_recMaxSplats;
    s.avgSplats = m_recSplatFrames ? m_recSplatSum / static_cast<double>(m_recSplatFrames) : 0.0;
    s.maxModels = m_recMaxModels;
    s.refreshHz = m_recExpectedMs > 0.0f ? 1000.0f / m_recExpectedMs : 0.0f;
    s.avgGpuSceneMs = m_recGpuSamples ? static_cast<float>(m_recGpuSceneSum / static_cast<double>(m_recGpuSamples)) : -1.0f;

    if (m_recFrames > 0 && m_recIntervalSum > 0.0) {
        const auto frames = static_cast<double>(m_recFrames);
        s.avgFps = static_cast<float>(frames * 1000.0 / m_recIntervalSum);
        s.avgFrameMs = static_cast<float>(m_recIntervalSum / frames);
        s.avgCpuSceneMs = static_cast<float>(m_recCpuSceneSum / frames);
    }
    std::vector<float> sorted = m_recIntervals;
    std::sort(sorted.begin(), sorted.end());
    if (!sorted.empty()) {
        s.p50FrameMs = Percentile(sorted, 0.50f);
        s.p95FrameMs = Percentile(sorted, 0.95f);
        s.p99FrameMs = Percentile(sorted, 0.99f);
        s.maxFrameMs = sorted.back();
        // 1% low: the average frame time of the slowest 1% of frames, as fps
        const std::size_t count = std::max<std::size_t>(1, sorted.size() / 100);
        double worstSum = 0.0;
        for (std::size_t i = sorted.size() - count; i < sorted.size(); ++i) worstSum += sorted[i];
        const double worstMean = worstSum / static_cast<double>(count);
        s.onePercentLowFps = worstMean > 0.0 ? static_cast<float>(1000.0 / worstMean) : 0.0f;
    }
    // Slowest second, ignoring seconds with under half a second of frames (the partial last one, pauses)
    s.minSecondFps = s.avgFps;
    for (const RecordingSecond& sec : m_recSeconds) {
        if (sec.frames == 0 || sec.intervalSum < 500.0) continue;
        s.minSecondFps = std::min(s.minSecondFps, static_cast<float>(sec.frames * 1000.0 / sec.intervalSum));
    }

    // Summary + per second series, read by the metrics dashboard. Written to a temp file first so
    // the dashboard never reads half a file.
    const std::string tmpPath = s.jsonPath + ".tmp";
    bool jsonOk = false;
    {
        std::ofstream json(tmpPath, std::ios::out | std::ios::trunc);
        json << "{\n";
        json << "  \"version\": 1,\n";
        json << "  \"id\": " << JsonString(s.id) << ",\n";
        json << "  \"startedAt\": " << JsonString(m_recStartedAt) << ",\n";
        json << "  \"host\": " << JsonString(QSysInfo::machineHostName().toStdString()) << ",\n";
        json << "  \"gpu\": " << JsonString(m_gpuName) << ",\n";
        json << "  \"csvFile\": " << JsonString(QFileInfo(QString::fromStdString(s.csvPath)).fileName().toStdString()) << ",\n";
        json << Format("  \"durationSec\": %.3f,\n  \"frames\": %llu,\n", s.durationSec, static_cast<unsigned long long>(s.frames));
        json << Format("  \"avgFps\": %.2f,\n  \"onePercentLowFps\": %.2f,\n  \"minSecondFps\": %.2f,\n",
                       s.avgFps, s.onePercentLowFps, s.minSecondFps);
        json << Format("  \"avgFrameMs\": %.3f,\n  \"p50FrameMs\": %.3f,\n  \"p95FrameMs\": %.3f,\n  \"p99FrameMs\": %.3f,\n  \"maxFrameMs\": %.3f,\n",
                       s.avgFrameMs, s.p50FrameMs, s.p95FrameMs, s.p99FrameMs, s.maxFrameMs);
        json << Format("  \"drops\": %llu,\n  \"missedVsyncs\": %llu,\n  \"pauses\": %llu,\n",
                       static_cast<unsigned long long>(s.drops), static_cast<unsigned long long>(s.missedVsyncs),
                       static_cast<unsigned long long>(s.pauses));
        json << Format("  \"refreshHz\": %.2f,\n  \"avgCpuSceneMs\": %.3f,\n", s.refreshHz, s.avgCpuSceneMs);
        if (s.avgGpuSceneMs >= 0.0f) json << Format("  \"avgGpuSceneMs\": %.3f,\n", s.avgGpuSceneMs);
        else json << "  \"avgGpuSceneMs\": null,\n";
        json << Format("  \"splats\": { \"min\": %zu, \"max\": %zu, \"avg\": %.1f },\n  \"maxModels\": %zu,\n",
                       s.minSplats, s.maxSplats, s.avgSplats, s.maxModels);
        json << "  \"seconds\": [";
        for (std::size_t i = 0; i < m_recSeconds.size(); ++i) {
            const RecordingSecond& sec = m_recSeconds[i];
            json << (i ? ",\n    " : "\n    ");
            if (sec.frames > 0 && sec.intervalSum > 0.0) {
                json << Format("{ \"t\": %zu, \"fps\": %.2f, \"frames\": %u, \"maxFrameMs\": %.3f, \"drops\": %u, \"splats\": %zu, \"models\": %zu }",
                               i, sec.frames * 1000.0 / sec.intervalSum, sec.frames, sec.maxFrameMs, sec.drops, sec.splats, sec.models);
            }
            else {
                json << Format("{ \"t\": %zu, \"fps\": null, \"frames\": 0, \"maxFrameMs\": null, \"drops\": 0, \"splats\": %zu, \"models\": %zu }",
                               i, sec.splats, sec.models);
            }
        }
        json << (m_recSeconds.empty() ? "]\n" : "\n  ]\n");
        json << "}\n";
        json.flush();
        jsonOk = json.good();
    }
    if (jsonOk) {
        QFile::remove(QString::fromStdString(s.jsonPath));
        jsonOk = QFile::rename(QString::fromStdString(tmpPath), QString::fromStdString(s.jsonPath));
    }
    if (!jsonOk) QFile::remove(QString::fromStdString(tmpPath));

    LogInfo(Format("[Metrics] Recording %s: %.1f s, %llu frames, avg %.1f FPS (1%% low %.1f), p95 %.2f ms, "
                   "%llu drops, splats %zu-%zu",
                   s.id.c_str(), s.durationSec, static_cast<unsigned long long>(s.frames), s.avgFps,
                   s.onePercentLowFps, s.p95FrameMs, static_cast<unsigned long long>(s.drops),
                   s.minSplats, s.maxSplats));
    if (jsonOk) LogInfo("[Metrics] Saved " + s.csvPath + " and " + s.jsonPath);
    else LogWarning("[Metrics] Could not write the recording summary " + s.jsonPath + " (frames kept in " + s.csvPath + ")");

    m_recIntervals.clear();
    m_recIntervals.shrink_to_fit();
    m_recSeconds.clear();
    m_recSeconds.shrink_to_fit();

    if (onRecordingFinished) onRecordingFinished(s);
}

void FrameMetrics::CopyIntervalHistory(std::vector<float>& out) const {
    out.assign(kHistorySize, 0.0f);
    const std::uint64_t count = std::min<std::uint64_t>(m_finalizedEnd, kHistorySize);
    const std::uint64_t first = m_finalizedEnd - count;
    for (std::uint64_t i = 0; i < count; ++i) {
        out[kHistorySize - count + i] = m_history[(first + i) % kHistorySize].intervalMs;
    }
}
