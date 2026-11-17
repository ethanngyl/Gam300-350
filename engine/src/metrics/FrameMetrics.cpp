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

#include <QDateTime>
#include <QDebug>
#include <QDir>
#include <QString>

#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <cstdio>

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

    // Deletes all but the newest kKeepRuns runs. Names sort by time (metrics_YYYYMMDD_HHMMSS_*).
    void PruneOldRuns(QDir dir) {
        for (const char* suffix : { "_sessions.csv", "_frames.csv" }) {
            QStringList files = dir.entryList({ QString("metrics_*") + suffix }, QDir::Files, QDir::Name);
            while (files.size() > kKeepRuns) {
                dir.remove(files.takeFirst());
            }
        }
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

    if (logDir.empty()) return;

    const QDir dir(QString::fromStdString(logDir));
    if (!QDir().mkpath(dir.absolutePath())) {
        LogWarning("[Metrics] Could not create " + logDir + ", metrics are not written to file");
        return;
    }
    PruneOldRuns(dir);

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
    PollGpuQueries();
    ProcessReadyFrames(true);
    if (m_sessionOpen) CloseSession();

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
    while (m_nextToProcess + delay < m_finalizedEnd) {
        ProcessFrame(m_history[m_nextToProcess % kHistorySize]);
        ++m_nextToProcess;
    }
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

void FrameMetrics::CopyIntervalHistory(std::vector<float>& out) const {
    out.assign(kHistorySize, 0.0f);
    const std::uint64_t count = std::min<std::uint64_t>(m_finalizedEnd, kHistorySize);
    const std::uint64_t first = m_finalizedEnd - count;
    for (std::uint64_t i = 0; i < count; ++i) {
        out[kHistorySize - count + i] = m_history[(first + i) % kHistorySize].intervalMs;
    }
}
