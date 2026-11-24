/*!************************************************************************
\file LocalReconstruction.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
Implements LocalReconstruction: finding the tools, probing which flags this
COLMAP / Brush build understands (as packages/src/backend/config.js does),
copying the inputs into a working folder, and running each pipeline stage
as a QProcess with the backend's arguments, progress bands and error
messages. Keep the tool arguments in step with pipeline.js / config.js.
**************************************************************************/
#include "pipeline/LocalReconstruction.h"

#include "pipeline/GenerationSettings.h"
#include "pipeline/PlyNormalizer.h"
#include "pipeline/SplatAutoCrop.h"
#include "ui/AssetPaths.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QDirIterator>
#include <QElapsedTimer>
#include <QFileInfo>
#include <QLocale>
#include <QProcess>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QThread>
#include <QTimer>

#include <algorithm>
#include <cmath>
#include <exception>

namespace {
#ifdef Q_OS_WIN
    const QString kExe = QStringLiteral(".exe");
#else
    const QString kExe;
#endif

    // Shared with the dialog and the command-line build (GenerationSettings.h).
    using generation::kDefaultFps;
    using generation::kDefaultTrainIters;
    using generation::kMaxTrainIters;
    using generation::kMinPhotos;
    using generation::kMinTrainIters;
    using generation::kPhotoSuffixes;
    using generation::SafeFileName;

    // Must match the backend (config.js defaults).
    constexpr int kMaxResolution = 1024;
    constexpr int kMaxFrames = 200;
    constexpr int kFrameTimeoutMs = 30 * 60 * 1000;
    const QString kMaskModel = QStringLiteral("isnet-general-use");
    const QString kRedundantPointsFlag = QStringLiteral("--Mapper.ba_global_ignore_redundant_points3D");
    // Build logs kept in BuildsRoot()/logs.
    constexpr int kKeepLogs = 20;

    // pipeline.js NO_MODEL_MESSAGE: any way the mapper fails to build a model means the same to the user.
    const QString kNoModelMessage =
        QStringLiteral("COLMAP could not reconstruct a model from these photos. Try more photos with more overlap and texture.");

    // No console window per tool (the engine is a GUI app; each console tool would flash one).
    void HideConsole(QProcess& process) {
#ifdef Q_OS_WIN
        process.setCreateProcessArgumentsModifier([](QProcess::CreateProcessArguments* args) {
            args->flags |= 0x08000000; // CREATE_NO_WINDOW
        });
#else
        Q_UNUSED(process);
#endif
    }

    // Runs a quick command (a --help probe) and returns everything it printed; empty if it couldn't run.
    // Blocking: only called from the preparation worker thread. Gives up within ~100 ms once
    // cancelled is set, so Cancel and quitting don't wait out the timeout.
    QString RunForOutput(const QString& program, const QStringList& args, const std::atomic_bool& cancelled,
                         int timeoutMs = 15000) {
        if (program.isEmpty() || cancelled) return QString();
        QProcess process;
        HideConsole(process);
        process.setProcessChannelMode(QProcess::MergedChannels);
        process.start(program, args);
        if (!process.waitForStarted(timeoutMs)) return QString();
        QElapsedTimer clock;
        clock.start();
        while (!process.waitForFinished(100)) {
            if (process.state() == QProcess::NotRunning) break;
            if (cancelled || clock.elapsed() > timeoutMs) {
                process.kill();
                process.waitForFinished(2000);
                break;
            }
        }
        return QString::fromLocal8Bit(process.readAll());
    }

    QString ExistingFile(const QString& path) {
        return !path.isEmpty() && QFileInfo(path).isFile() ? QFileInfo(path).absoluteFilePath() : QString();
    }

    // First file under dir (searched recursively, shallowest first) whose name matches pattern.
    QString FindUnder(const QString& dir, const QRegularExpression& pattern) {
        if (dir.isEmpty() || !QFileInfo(dir).isDir()) return QString();
        QString best;
        int bestDepth = 1 << 30;
        QDirIterator it(dir, QDir::Files, QDirIterator::Subdirectories);
        while (it.hasNext()) {
            const QString path = it.next();
            if (!pattern.match(it.fileName()).hasMatch()) continue;
            const int depth = static_cast<int>(path.count('/'));
            if (depth < bestDepth) {
                best = path;
                bestDepth = depth;
            }
        }
        return best;
    }

    QString FindPython() {
        if (const QString env = qEnvironmentVariable("PYTHON_BIN"); !env.isEmpty()) return env;
#ifdef Q_OS_WIN
        // Skip the Microsoft Store "python.exe" alias: it opens the Store instead of running anything.
        const QStringList dirs = qEnvironmentVariable("PATH").split(QDir::listSeparator(), Qt::SkipEmptyParts);
        for (const QString& dir : dirs) {
            if (dir.contains("Microsoft\\WindowsApps", Qt::CaseInsensitive) || dir.contains("Microsoft/WindowsApps", Qt::CaseInsensitive)) continue;
            const QString candidate = QDir(dir).filePath("python.exe");
            if (QFileInfo(candidate).isFile()) return candidate;
        }
        return QString();
#else
        return QStandardPaths::findExecutable("python3");
#endif
    }
}

// ===========================================================================
// Tools
// ===========================================================================

LocalReconstruction::Tools LocalReconstruction::FindTools() {
    Tools tools;

    // tools/ folder: GENESIS_TOOLS_DIR, next to the engine (an install), up from the build folder,
    // or the source tree's (ENGINE_ASSETS_DIR is <repo>/engine/assets).
    QStringList candidates;
    if (const QString env = qEnvironmentVariable("GENESIS_TOOLS_DIR"); !env.isEmpty()) candidates << env;
    QDir up(QCoreApplication::applicationDirPath());
    for (int level = 0; level < 6; ++level) {
        candidates << up.filePath("tools");
        if (!up.cdUp()) break;
    }
#ifdef ENGINE_ASSETS_DIR
    candidates << QDir(QStringLiteral(ENGINE_ASSETS_DIR) + "/../../tools").absolutePath();
#endif
    for (const QString& dir : candidates) {
        if (QFileInfo(dir + "/colmap").isDir() || QFileInfo(dir + "/brush").isDir()) {
            tools.toolsDir = QDir(dir).absolutePath();
            break;
        }
    }

    // Same precedence as config.js: explicit env var > tools/ > PATH.
    tools.colmap = ExistingFile(qEnvironmentVariable("COLMAP_BIN"));
    if (tools.colmap.isEmpty() && !tools.toolsDir.isEmpty()) {
        tools.colmap = FindUnder(tools.toolsDir + "/colmap",
                                 QRegularExpression("^colmap" + QRegularExpression::escape(kExe) + "$",
                                                    QRegularExpression::CaseInsensitiveOption));
    }
    if (tools.colmap.isEmpty()) tools.colmap = QStandardPaths::findExecutable("colmap");

    tools.brush = ExistingFile(qEnvironmentVariable("BRUSH_BIN"));
    if (tools.brush.isEmpty() && !tools.toolsDir.isEmpty()) {
        tools.brush = FindUnder(tools.toolsDir + "/brush",
                                QRegularExpression("^brush[\\w-]*" + QRegularExpression::escape(kExe) + "$",
                                                   QRegularExpression::CaseInsensitiveOption));
    }
    if (tools.brush.isEmpty()) tools.brush = QStandardPaths::findExecutable("brush_app");
    if (tools.brush.isEmpty()) tools.brush = QStandardPaths::findExecutable("brush");

    tools.python = FindPython();
    tools.nvidiaSmi = QStandardPaths::findExecutable("nvidia-smi");
    return tools;
}

QString LocalReconstruction::MissingTools(const GenerationRequest& request, const Tools& tools) {
    QStringList missing;
    if (tools.colmap.isEmpty()) missing << "COLMAP";
    if (tools.brush.isEmpty()) missing << "Brush";
    const bool needsPython = request.source == GenerationRequest::Source::Media || request.removeBackground;
    if (needsPython && tools.python.isEmpty()) missing << "Python (for videos and background removal)";
    if (needsPython) {
        // Without a tools/ folder (COLMAP and Brush found on PATH or through COLMAP_BIN) the
        // scripts can't be found either: report them, rather than running "python /extract_frames.py".
        const QString script = request.source == GenerationRequest::Source::Media ? "extract_frames.py" : "make_masks.py";
        if (tools.toolsDir.isEmpty() || !QFileInfo(tools.toolsDir + "/" + script).isFile()) missing << "tools/" + script;
    }
    if (missing.isEmpty()) return QString();
    return QString("Missing on this PC: %1. Run tools/get-tools.ps1 to download COLMAP and Brush%2.")
        .arg(missing.join(", "), needsPython ? ", and install Python with: pip install -r tools/requirements.txt" : "");
}

QString LocalReconstruction::BuildsRoot() {
    return AssetPaths::UserDataDir() + "/local-builds";
}

// ===========================================================================
// Build
// ===========================================================================

LocalReconstruction::LocalReconstruction(QObject* parent)
    : QObject(parent)
    , m_timeout(new QTimer(this)) {
    m_timeout->setSingleShot(true);
    connect(m_timeout, &QTimer::timeout, this, [this] {
        m_timedOut = true;
        killTool();
    });
}

LocalReconstruction::~LocalReconstruction() {
    m_cancelled = true;
    if (m_process) {
        m_process->disconnect(this);
        killTool();
        m_process->waitForFinished(3000);
    }
    if (m_worker) {
        m_worker->disconnect(this);
        m_worker->wait(); // never destroy a running QThread; the workers check m_cancelled
        delete m_worker;
    }
    // Quit while "Finalizing model": the save worker may have finished the move before it saw
    // m_cancelled, and its done() will never run now. The quit prompt promised nothing is kept.
    if (!m_unclaimedResult.isEmpty()) QFile::remove(m_unclaimedResult);
    if (m_running) removeWorkFiles();
}

void LocalReconstruction::start(const GenerationRequest& request, const QString& outputFolder) {
    if (m_running) return;
    m_running = true;
    m_cancelled = false;
    m_timedOut = false;
    m_request = request;
    m_outputFolder = outputFolder;
    m_tools = FindTools();
    m_prepared = Prepared();
    m_colmapMaskArgs.clear();
    m_lastLine.clear();
    m_scriptError.clear();

    const QString root = BuildsRoot();
    m_id = "local_" + QDateTime::currentDateTime().toString("yyyyMMdd_HHmmss_zzz");
    m_workspace = root + "/" + m_id;
    m_exportDir = root + "/" + m_id + "_out";

    const QString logDir = root + "/logs";
    QDir().mkpath(logDir);
    AssetPaths::PruneOldFiles(logDir, "*.log", kKeepLogs); // local_<date>_<time>.log sorts by time
    m_log.close();
    m_log.setFileName(logDir + "/" + m_id + ".log");
    if (!m_log.open(QIODevice::WriteOnly | QIODevice::Text)) {
        qWarning("Couldn't write the build log %s", qPrintable(QDir::toNativeSeparators(m_log.fileName())));
    }

    m_status = JobStatus();
    m_status.id = m_id;
    m_status.status = "running";
    setPhase("upload", 0.0, "Checking the tools...");
    log(QString("Building on this PC: %1 file(s), %2 iterations%3")
            .arg(request.files.size()).arg(request.trainIters)
            .arg(QString(request.removeBackground ? ", background removed" : "")
                 + (request.autoCrop ? ", main object only" : "")));
    log("COLMAP: " + QDir::toNativeSeparators(m_tools.colmap));
    log("Brush:  " + QDir::toNativeSeparators(m_tools.brush));

    const QString missing = MissingTools(request, m_tools);
    if (!missing.isEmpty()) {
        fail(missing);
        return;
    }

    // Probe the tools and copy the inputs on a worker thread: probes take a few seconds and
    // a photo batch can be hundreds of MB.
    auto prepared = std::make_shared<Prepared>();
    runWorker([this, prepared] {
        Prepared& p = *prepared;
        const QString colmap = m_tools.colmap;

        // config.js colmapUseGpu: a CUDA build AND an NVIDIA driver, else COLMAP runs on the CPU.
        // Each probe returns early once m_cancelled is set; onPrepared() then reports the cancel.
        const bool cuda = RunForOutput(colmap, { "-h" }, m_cancelled).contains("with CUDA", Qt::CaseInsensitive);
        const bool nvidia = QRegularExpression("^GPU \\d+:", QRegularExpression::MultilineOption)
                                .match(RunForOutput(m_tools.nvidiaSmi, { "-L" }, m_cancelled)).hasMatch();
        if (m_cancelled) return;
        p.colmapGpu = cuda && nvidia;
        if (const QString env = qEnvironmentVariable("COLMAP_USE_GPU"); !env.isEmpty()) p.colmapGpu = env == "1";

        // COLMAP 4.x renamed SiftExtraction / SiftMatching to FeatureExtraction / FeatureMatching.
        const QString extractorHelp = RunForOutput(colmap, { "feature_extractor", "--help" }, m_cancelled);
        if (extractorHelp.contains("--SiftExtraction.use_gpu") && !extractorHelp.contains("--FeatureExtraction.use_gpu")) {
            p.extractionNs = "SiftExtraction";
            p.matchingNs = "SiftMatching";
        }
        const QString matcherHelp = RunForOutput(colmap, { "exhaustive_matcher", "--help" }, m_cancelled);
        p.minInliersFlag = matcherHelp.contains("--TwoViewGeometry.min_num_inliers")
                               ? QStringLiteral("--TwoViewGeometry.min_num_inliers")
                               : "--" + p.matchingNs + ".min_num_inliers";
        // config.js colmapFastMapperArgs: new in COLMAP 4, older builds exit on the unknown flag.
        p.skipRedundantPoints = qEnvironmentVariable("COLMAP_SKIP_REDUNDANT_POINTS") != "0"
            && RunForOutput(colmap, { "mapper", "--help" }, m_cancelled).contains(kRedundantPointsFlag);

        // Brush v0.3.0 says --total-steps, newer builds --total-train-iters.
        const QString brushHelp = RunForOutput(m_tools.brush, { "--help" }, m_cancelled);
        if (m_cancelled) return;
        if (brushHelp.isEmpty()) {
            p.error = "Brush could not be started (" + QDir::toNativeSeparators(m_tools.brush) + ").";
            return;
        }
        p.itersFlag = brushHelp.contains("--total-steps") ? QStringLiteral("--total-steps") : QStringLiteral("--total-train-iters");
        p.alphaMode = brushHelp.contains("--alpha-mode");

        // Inputs get stable ordered names, as the backend's upload does (0000.jpg, 0001.png, ...).
        const bool media = m_request.source == GenerationRequest::Source::Media;
        const QString target = m_workspace + (media ? "/media" : "/images");
        if (!QDir().mkpath(target) || !QDir().mkpath(m_workspace + "/images")) {
            p.error = "Couldn't create the working folder " + QDir::toNativeSeparators(m_workspace);
            return;
        }
        int index = 0;
        for (const QString& file : m_request.files) {
            if (m_cancelled) return;
            const QString suffix = QFileInfo(file).suffix().toLower();
            const QString dest = QString("%1/%2.%3").arg(target).arg(index++, 4, 10, QChar('0')).arg(suffix.isEmpty() ? "jpg" : suffix);
            if (!QFile::copy(file, dest)) {
                p.error = "Couldn't copy " + QDir::toNativeSeparators(file) + " into the working folder.";
                return;
            }
        }
    },[this, prepared] { onPrepared(*prepared); });
}

void LocalReconstruction::onPrepared(const Prepared& prepared) {
    if (m_cancelled) {
        fail("Cancelled.");
        return;
    }
    if (!prepared.error.isEmpty()) {
        fail(prepared.error);
        return;
    }
    m_prepared = prepared;
    log(QString("COLMAP on the %1, %2 flags; Brush %3%4")
            .arg(prepared.colmapGpu ? "GPU" : "CPU (no CUDA build or NVIDIA GPU found, slower)")
            .arg(prepared.extractionNs, prepared.itersFlag, prepared.alphaMode ? ", --alpha-mode" : ""));

    if (m_request.source == GenerationRequest::Source::Media) {
        extractFrames();
    } else if (m_request.removeBackground) {
        generateMasks();
    } else {
        runColmap();
    }
}

void LocalReconstruction::extractFrames() {
    const QString mediaDir = m_workspace + "/media";
    QStringList mediaFiles;
    const QStringList names = QDir(mediaDir).entryList(QDir::Files, QDir::Name); // 0000.mp4, 0001.mov... keeps their order
    for (const QString& name : names) mediaFiles << QDir(mediaDir).filePath(name);

    ToolStep step;
    step.phase = "extract";
    step.program = m_tools.python;
    step.args << m_tools.toolsDir + "/extract_frames.py";
    step.args << mediaFiles;
    step.args << "--output" << m_workspace + "/images"
              << "--fps" << QString::number(m_request.fps > 0.0 ? m_request.fps : kDefaultFps)
              << "--max-frames" << QString::number(kMaxFrames);
    step.timeoutMs = kFrameTimeoutMs;
    step.onLine = [this](const QString& line) {
        static const QRegularExpression progress("^PROGRESS extract ([\\d.]+)");
        if (const auto match = progress.match(line); match.hasMatch()) {
            const double fraction = match.captured(1).toDouble();
            setProgress(0.05 * fraction, QString("Extracting frames... %1%").arg(qRound(fraction * 100)));
        }
    };
    runTool(step, [this, mediaDir] {
        QDir(mediaDir).removeRecursively();
        const int frames = static_cast<int>(
            QDir(m_workspace + "/images").entryList(generation::NamePatterns(kPhotoSuffixes), QDir::Files).size());
        log(QString("Extracted %1 frames.").arg(frames));
        if (frames < kMinPhotos) {
            fail(QString("Extracted only %1 frame(s). Need at least %2 for a reconstruction - try a longer clip or a higher fps.")
                     .arg(frames).arg(kMinPhotos));
            return;
        }
        if (m_request.removeBackground) generateMasks();
        else runColmap();
    });
}

void LocalReconstruction::generateMasks() {
    // Two mask sets, as pipeline.js generateMasks: masks/ is read by Brush automatically,
    // colmap_stencils/ is passed to COLMAP (its own folder so Brush doesn't see two masks per image).
    const QString stencils = m_workspace + "/colmap_stencils";
    const double base = std::min(m_status.progress, 0.05);

    ToolStep step;
    step.phase = "masking";
    step.progress = base;
    step.program = m_tools.python;
    step.args << m_tools.toolsDir + "/make_masks.py" << m_workspace + "/images"
              << "--colmap-out" << stencils << "--brush-out" << m_workspace + "/masks" << "--model" << kMaskModel;
    step.onLine = [this, base](const QString& line) {
        static const QRegularExpression progress("^PROGRESS mask ([\\d.]+)");
        if (const auto match = progress.match(line); match.hasMatch()) {
            const double fraction = match.captured(1).toDouble();
            setProgress(base + (0.05 - base) * fraction, QString("Removing backgrounds... %1%").arg(qRound(fraction * 100)));
        }
    };
    setPhase("masking", base, "Loading background-removal model...");
    runTool(step, [this, stencils] {
        m_colmapMaskArgs = { "--ImageReader.mask_path", stencils };
        runColmap();
    });
}

void LocalReconstruction::runColmap() {
    const QString database = m_workspace + "/database.db";
    const QString images = m_workspace + "/images";
    const QString sparse = m_workspace + "/sparse";
    const QString useGpu = m_prepared.colmapGpu ? "1" : "0";

    ToolStep features;
    features.phase = "colmap-features";
    features.progress = 0.05;
    features.program = m_tools.colmap;
    features.args << "feature_extractor" << "--database_path" << database << "--image_path" << images
                  << "--ImageReader.single_camera" << "1";
    features.args << m_colmapMaskArgs;
    features.args << "--" + m_prepared.extractionNs + ".use_gpu" << useGpu;

    // config.js colmapStrictMatcherArgs / colmapStrictMapperArgs: stricter matching so symmetric,
    // low-texture objects don't get cameras on the wrong side (ghost copies).
    ToolStep matching;
    matching.phase = "colmap-matching";
    matching.progress = 0.2;
    matching.program = m_tools.colmap;
    matching.args << "exhaustive_matcher" << "--database_path" << database
                  << "--" + m_prepared.matchingNs + ".use_gpu" << useGpu
                  << m_prepared.minInliersFlag << "50"
                  << "--" + m_prepared.matchingNs + ".guided_matching" << "1";

    ToolStep mapper;
    mapper.phase = "colmap-mapping";
    mapper.progress = 0.35;
    mapper.program = m_tools.colmap;
    mapper.args << "mapper" << "--database_path" << database << "--image_path" << images << "--output_path" << sparse
                << "--Mapper.init_min_num_inliers" << "200"
                << "--Mapper.abs_pose_min_num_inliers" << "60"
                << "--Mapper.abs_pose_min_inlier_ratio" << "0.35";
    // Leaves redundant points out of the full-model bundle adjustments: on 311 Panther photos
    // mapping took 18.8 min instead of 29.9, with every photo still placed.
    if (m_prepared.skipRedundantPoints) mapper.args << kRedundantPointsFlag << "1";
    mapper.failMessage = kNoModelMessage;

    runTool(features, [this, matching, mapper, sparse] {
        runTool(matching, [this, mapper, sparse] {
            QDir().mkpath(sparse);
            runTool(mapper, [this, sparse] {
                // The mapper writes sparse/0 (sometimes 1, 2... if it splits). At least one is needed.
                const QStringList models = QDir(sparse).entryList(QDir::Dirs | QDir::NoDotAndDotDot);
                const bool any = std::any_of(models.begin(), models.end(), [](const QString& name) {
                    bool numeric = false;
                    name.toInt(&numeric);
                    return numeric;
                });
                if (!any) {
                    fail(kNoModelMessage);
                    return;
                }
                train();
            });
        });
    });
}

void LocalReconstruction::train() {
    const int total = std::clamp(m_request.trainIters > 0 ? m_request.trainIters : kDefaultTrainIters,
                                 kMinTrainIters, kMaxTrainIters);
    ToolStep step;
    step.phase = "training";
    step.progress = 0.45;
    step.program = m_tools.brush;
    // Dataset and export paths relative to the builds folder, exactly as the backend runs it.
    step.args << m_id
              << "--max-resolution" << QString::number(kMaxResolution)
              << m_prepared.itersFlag << QString::number(total)
              << "--export-path" << "./" + m_id + "_out/"
              << "--export-name" << "splat_{iter}.ply"
              << "--export-every" << QString::number(total);
    // With masks, the background is trained as empty space so no haze of splats is left around the object.
    if (m_request.removeBackground && m_prepared.alphaMode) step.args << "--alpha-mode" << "transparent";
    step.workDir = BuildsRoot();
    // Brush only prints its progress bar to a terminal; with RUST_LOG=info it logs lines carrying the step.
    step.env = QProcessEnvironment::systemEnvironment();
    step.env.insert("RUST_LOG", "info");
    step.onLine = [this, total](const QString& line) {
        static const QRegularExpression iter("\\biter[= ](\\d[\\d,]*)", QRegularExpression::CaseInsensitiveOption);
        if (const auto match = iter.match(line); match.hasMatch()) {
            const int current = match.captured(1).remove(',').toInt();
            if (current >= 0 && current <= total) {
                const QLocale locale;
                setProgress(0.45 + 0.53 * (static_cast<double>(current) / total),
                            QString("Iteration %1 / %2").arg(locale.toString(current), locale.toString(total)));
            }
        }
    };
    runTool(step, [this] { finishModel(); });
}

void LocalReconstruction::finishModel() {
    // The highest-iteration export (names sort by iteration, as scan.js highestRawPly).
    QStringList plys = QDir(m_exportDir).entryList({ "*.ply" }, QDir::Files, QDir::Name);
    plys.removeAll("result.ply");
    if (plys.isEmpty()) {
        fail("Training finished but no .ply was exported.");
        return;
    }
    const QString rawPly = QDir(m_exportDir).filePath(plys.last());
    const bool autoCrop = m_request.autoCrop;
    setPhase(autoCrop ? "crop" : "normalize", 0.99);

    struct Result {
        QString path;
        QString error;
        QStringList log;
    };
    auto result = std::make_shared<Result>();
    QString name = SafeFileName(m_request.name);
    if (name.isEmpty()) name = "Model " + QDateTime::currentDateTime().toString("yyyy-MM-dd HHmm");
    const QString exportDir = m_exportDir;
    const QString outputFolder = m_outputFolder;
    const QString sparseDir = m_workspace + "/sparse";

    m_unclaimedResult.clear();
    // Captures this for m_cancelled / m_unclaimedResult: the destructor waits for the worker.
    runWorker([this, result, rawPly, name, exportDir, outputFolder, autoCrop, sparseDir] {
        // Keep only the object the photos were taken around, before normalizing so the model is
        // centred and sized on it alone. Best effort, like the backend: if the capture doesn't
        // suit it or it fails, the whole model is kept. Brush exports in COLMAP's frame, so the
        // camera poses in sparse/ apply directly.
        QString toNormalize = rawPly;
        if (autoCrop) {
            const QString cropped = exportDir + "/cropped.ply";
            AutoCropReport crop;
            QString cropError;
            try {
                cropError = AutoCropSplatPly(sparseDir, rawPly, cropped, crop);
            } catch (const std::exception& e) {
                cropError = QString("out of memory or bad data (%1)").arg(QString::fromLocal8Bit(e.what()));
            }
            if (!cropError.isEmpty()) {
                result->log << "Auto-crop failed (" + cropError + "); keeping the whole model.";
            } else if (!crop.cropped) {
                result->log << "Auto-crop skipped: " + crop.reason;
            } else {
                toNormalize = cropped;
                result->log << QString("Auto-crop kept %1 of %2 splats (%3%) around the main object "
                                       "(%4/%5 photos aimed at it, %6 degree arc)")
                                   .arg(crop.kept).arg(crop.total)
                                   .arg(std::lround(100.0 * static_cast<double>(crop.kept) / static_cast<double>(crop.total)))
                                   .arg(crop.camerasAimed).arg(crop.cameras).arg(std::lround(crop.arcDegrees));
            }
        }
        if (m_cancelled) return;

        // Recentre and rescale into the viewer's frame. Best effort, like the backend: if it fails
        // the (cropped) export is used.
        QString source = toNormalize;
        const QString normalized = exportDir + "/result.ply";
        QString summary;
        QString error;
        try {
            error = NormalizeSplatPly(toNormalize, normalized, 1.5, &summary);
        } catch (const std::exception& e) {
            // An exception escaping this worker thread would end the whole editor.
            error = QString("out of memory or bad data (%1)").arg(QString::fromLocal8Bit(e.what()));
        }
        if (error.isEmpty()) {
            source = normalized;
            result->log << summary;
        } else {
            result->log << "Normalization failed (" + error + "); keeping the raw export.";
        }

        if (m_cancelled) return; // cancelled or quitting: don't save anything
        if (!QDir().mkpath(outputFolder)) {
            result->error = "Couldn't create " + QDir::toNativeSeparators(outputFolder);
            return;
        }
        QString dest = QDir(outputFolder).filePath(name + ".ply");
        for (int n = 2; QFileInfo::exists(dest); ++n) {
            dest = QDir(outputFolder).filePath(QString("%1 (%2).ply").arg(name).arg(n));
        }
        // rename is instant on the same drive; copy covers a folder on another drive.
        if (!QFile::rename(source, dest) && !QFile::copy(source, dest)) {
            result->error = "Couldn't save the model to " + QDir::toNativeSeparators(dest);
            return;
        }
        result->path = dest;
        m_unclaimedResult = dest;
    }, [this, result] {
        m_unclaimedResult.clear();
        for (const QString& line : result->log) log(line);
        if (m_cancelled) {
            // Cancelled while the model was being saved: the prompt promised nothing is kept.
            if (!result->path.isEmpty()) QFile::remove(result->path);
            fail("Cancelled.");
        } else if (!result->error.isEmpty()) {
            // Training succeeded; only the move into the output folder failed. Keep the export
            // folder so a long build isn't thrown away, and say where it is.
            fail(result->error + "\n\nThe trained model was kept in "
                     + QDir::toNativeSeparators(m_exportDir), true);
        } else {
            complete(result->path);
        }
    });
}

// ===========================================================================
// Running tools
// ===========================================================================

void LocalReconstruction::runTool(ToolStep step, std::function<void()> next) {
    if (m_cancelled) {
        fail("Cancelled.");
        return;
    }
    if (m_status.phase != step.phase) setPhase(step.phase, step.progress);
    const QString toolName = QFileInfo(step.program).completeBaseName();
    log("\n$ " + toolName + " " + step.args.join(' '));
    m_lastLine.clear();
    m_scriptError.clear();
    m_lineBuffer.clear();
    m_timedOut = false;

    auto* process = new QProcess(this);
    HideConsole(*process);
    process->setProgram(step.program);
    process->setArguments(step.args);
    if (!step.workDir.isEmpty()) process->setWorkingDirectory(step.workDir);
    if (!step.env.isEmpty()) process->setProcessEnvironment(step.env);
    process->setProcessChannelMode(QProcess::MergedChannels);
    m_process = process;

    // Tools draw progress with \r, so both \r and \n end a line.
    auto handleLines = [this, onLine = step.onLine] {
        int start = 0;
        for (int i = 0; i < m_lineBuffer.size(); ++i) {
            if (m_lineBuffer[i] != '\n' && m_lineBuffer[i] != '\r') continue;
            const QString line = QString::fromLocal8Bit(m_lineBuffer.mid(start, i - start)).trimmed();
            start = i + 1;
            if (line.isEmpty()) continue;
            log(line);
            m_lastLine = line;
            static const QRegularExpression scriptError("^ERROR:\\s*(.+)");
            if (const auto match = scriptError.match(line); match.hasMatch()) m_scriptError = match.captured(1);
            if (onLine) onLine(line);
        }
        m_lineBuffer.remove(0, start); // keep a partial last line for the next read
    };

    connect(process, &QProcess::readyReadStandardOutput, this, [this, process, handleLines] {
        m_lineBuffer += process->readAllStandardOutput();
        handleLines();
    });
    connect(process, &QProcess::errorOccurred, this, [this, process, toolName](QProcess::ProcessError error) {
        if (error != QProcess::FailedToStart) return; // the others also end in finished()
        m_timeout->stop();
        process->deleteLater();
        m_process = nullptr;
        if (m_cancelled) fail("Cancelled.");
        else fail(QString("Couldn't start %1: %2").arg(toolName, process->errorString()));
    });
    connect(process, &QProcess::finished, this,
            [this, process, toolName, next, handleLines, timeoutMs = step.timeoutMs, failMessage = step.failMessage](
                int exitCode, QProcess::ExitStatus exitStatus) {
                m_timeout->stop();
                m_lineBuffer += process->readAllStandardOutput();
                m_lineBuffer.append('\n'); // the last line may have no newline
                handleLines();
                process->deleteLater();
                m_process = nullptr;

                if (m_cancelled) {
                    fail("Cancelled.");
                } else if (m_timedOut) {
                    fail(QString("%1 timed out after %2 min").arg(toolName).arg(timeoutMs / 60000));
                } else if (exitStatus != QProcess::NormalExit || exitCode != 0) {
                    QString error = !failMessage.isEmpty() ? failMessage
                                  : !m_scriptError.isEmpty() ? m_scriptError
                                  : exitStatus != QProcess::NormalExit ? QString("%1 crashed").arg(toolName)
                                  : QString("%1 exited with code %2").arg(toolName).arg(exitCode);
                    if (failMessage.isEmpty() && m_scriptError.isEmpty() && !m_lastLine.isEmpty()) {
                        error += ": " + m_lastLine;
                    }
                    fail(error);
                } else {
                    next();
                }
            });

    if (step.timeoutMs > 0) m_timeout->start(step.timeoutMs);
    process->start();
}

void LocalReconstruction::runWorker(std::function<void()> work, std::function<void()> done) {
    QThread* thread = QThread::create(std::move(work));
    m_worker = thread;
    connect(thread, &QThread::finished, this, [this, thread, done = std::move(done)] {
        thread->deleteLater();
        m_worker = nullptr;
        done();
    });
    thread->start();
}

void LocalReconstruction::killTool() {
    if (!m_process || m_process->state() == QProcess::NotRunning) return;
#ifdef Q_OS_WIN
    // kill() only ends the direct child; taskkill /T takes the tools it started too
    // (as pipeline.js killChild does), so nothing keeps the GPU or the files busy.
    const qint64 pid = m_process->processId();
    if (pid > 0) {
        QProcess taskkill;
        HideConsole(taskkill);
        taskkill.start("taskkill", { "/PID", QString::number(pid), "/T", "/F" });
        taskkill.waitForFinished(5000);
    }
#endif
    m_process->kill();
}

void LocalReconstruction::cancel() {
    if (!m_running || m_cancelled) return;
    m_cancelled = true;
    log("\nCancelled by user.");
    if (m_process) killTool(); // finished() then reports the cancel
    // A worker checks m_cancelled and its done() reports it.
}

// ===========================================================================
// State
// ===========================================================================

void LocalReconstruction::setPhase(const QString& phase, double progress, const QString& detail) {
    m_status.phase = phase;
    m_status.progress = progress;
    m_status.detail = detail;
    emit statusChanged(m_status);
}

void LocalReconstruction::setProgress(double progress, const QString& detail) {
    m_status.progress = progress;
    m_status.detail = detail;
    emit statusChanged(m_status);
}

void LocalReconstruction::log(const QString& line) {
    if (m_log.isOpen()) {
        m_log.write(line.toUtf8());
        m_log.write("\n");
        m_log.flush();
    }
}

void LocalReconstruction::fail(const QString& error, bool keepExport) {
    if (!m_running) return;
    m_running = false;
    m_timeout->stop();
    const bool cancelled = m_cancelled;
    log(cancelled ? QString("\nCancelled.") : "\nERROR: " + error);
    m_log.close();
    m_status.status = cancelled ? "cancelled" : "error";
    m_status.error = cancelled ? QString() : error;
    emit statusChanged(m_status);
    removeWorkFiles(keepExport && !cancelled);
    emit finished(QString(), cancelled ? QStringLiteral("Cancelled.") : error);
}

void LocalReconstruction::complete(const QString& resultPath) {
    if (!m_running) return;
    m_running = false;
    log("\nDone. Result: " + QDir::toNativeSeparators(resultPath));
    m_log.close();
    m_status.status = "done";
    m_status.phase = "done";
    m_status.progress = 1.0;
    m_status.detail.clear();
    m_status.hasResult = true;
    emit statusChanged(m_status);
    removeWorkFiles();
    emit finished(resultPath, QString());
}

void LocalReconstruction::removeWorkFiles(bool keepExport) {
    // The photo copies, COLMAP database and Brush exports are only needed during the build.
    // On Windows a tool killed a moment ago can still hold a file, so try once more a little later.
    // keepExport: the final save failed, so the export folder holds the only copy of the model.
    QStringList dirs = { m_workspace };
    if (!keepExport) dirs << m_exportDir;
    bool leftovers = false;
    for (const QString& dir : dirs) {
        if (!dir.isEmpty() && QFileInfo(dir).exists() && !QDir(dir).removeRecursively()) leftovers = true;
    }
    if (leftovers) {
        QTimer::singleShot(2000, [dirs] {
            for (const QString& dir : dirs) QDir(dir).removeRecursively();
        });
    }
}
