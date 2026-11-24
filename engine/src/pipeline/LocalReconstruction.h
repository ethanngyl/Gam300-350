/*!************************************************************************
\file LocalReconstruction.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
Declares LocalReconstruction, which builds a Gaussian splat model on this PC
with no server: the engine-side port of the backend's reconstruction
pipeline (packages/src/backend/pipeline.js, by Xiong Yang and Gabriel). It
runs the same tools with the same settings, one after another:
  [videos]      python tools/extract_frames.py   (frames from the videos)
  [background]  python tools/make_masks.py       (foreground masks)
  COLMAP feature_extractor -> exhaustive_matcher -> mapper (camera poses)
  Brush (train the splats)
  NormalizeSplatPly (C++ port of tools/normalize_ply.py)
Photo builds need only COLMAP and Brush; Python is needed only for videos
and background removal. Each tool is a QProcess, so the editor never
freezes, and Cancel kills the tool and everything it started. The finished
.ply is saved into the chosen folder; the working files are deleted and a
log of every tool's output is kept under the user data folder.
**************************************************************************/
#pragma once

#include "pipeline/GenerationTypes.h"

#include <QFile>
#include <QObject>
#include <QPointer>
#include <QProcessEnvironment>
#include <QString>
#include <QStringList>

#include <atomic>
#include <functional>
#include <memory>

class QProcess;
class QThread;
class QTimer;

class LocalReconstruction : public QObject {
    Q_OBJECT

public:
    // Where the tools were found. Empty = not found.
    struct Tools {
        QString toolsDir;  // the repo's (or the install's) tools/ folder
        QString colmap;
        QString brush;
        QString python;
        QString nvidiaSmi;
    };

    // Looks for the tools: COLMAP_BIN / BRUSH_BIN / PYTHON_BIN, then a tools/ folder next to
    // the engine or in the source tree (filled by tools/get-tools.ps1), then PATH.
    static Tools FindTools();
    // What this PC is missing to build the request, worded for the user. Empty = ready.
    static QString MissingTools(const GenerationRequest& request, const Tools& tools);
    // Working folders and build logs: <user data>/local-builds.
    static QString BuildsRoot();

    explicit LocalReconstruction(QObject* parent = nullptr);
    // Kills a running tool (and its children) and removes the working files.
    ~LocalReconstruction() override;

    // Builds the request; the finished model is saved in outputFolder as "<name>.ply"
    // (or "<name> (2).ply" ... so nothing is overwritten). Answered by finished().
    void start(const GenerationRequest& request, const QString& outputFolder);
    void cancel();
    bool isRunning() const { return m_running; }
    // This build's log of every tool's output.
    QString logPath() const { return m_log.fileName(); }

signals:
    // Same shape as the server's GET /jobs/:id so the UI shows both alike.
    // progress is for the whole build (0..1), phase uses the backend's names.
    void statusChanged(const JobStatus& status);
    // resultPath is the saved .ply; error is empty on success, "Cancelled." when cancelled.
    void finished(const QString& resultPath, const QString& error);

private:
    // One tool run.
    struct ToolStep {
        QString phase;
        double progress = 0.0;       // whole-build progress when the step starts
        QString program;
        QStringList args;
        QString workDir;
        QProcessEnvironment env;     // empty = inherit
        std::function<void(const QString& line)> onLine;
        int timeoutMs = 0;           // 0 = no limit
        QString failMessage;         // shown instead of "<tool> exited with code N"
    };

    // What the background preparation found: tool flags this COLMAP / Brush build understands.
    struct Prepared {
        QString error;
        bool colmapGpu = false;
        QString extractionNs = "FeatureExtraction"; // COLMAP 4.x; 3.x says SiftExtraction
        QString matchingNs = "FeatureMatching";
        QString minInliersFlag;      // --TwoViewGeometry.min_num_inliers or --<matchingNs>.min_num_inliers
        bool skipRedundantPoints = false; // mapper understands --Mapper.ba_global_ignore_redundant_points3D
        QString itersFlag = "--total-train-iters";
        bool alphaMode = false;      // Brush understands --alpha-mode
    };

    void onPrepared(const Prepared& prepared);
    void extractFrames();
    void generateMasks();
    void runColmap();
    void train();
    void finishModel();

    void runTool(ToolStep step, std::function<void()> next);
    void runWorker(std::function<void()> work, std::function<void()> done);
    void setPhase(const QString& phase, double progress, const QString& detail = QString());
    void setProgress(double progress, const QString& detail);
    void log(const QString& line);
    // keepExport leaves m_exportDir on disk (used when only the final save failed).
    void fail(const QString& error, bool keepExport = false);
    void complete(const QString& resultPath);
    void killTool();
    void removeWorkFiles(bool keepExport = false);

    Tools m_tools;
    GenerationRequest m_request;
    QString m_outputFolder;
    QString m_id;             // folder name of this build under BuildsRoot()
    QString m_workspace;      // BuildsRoot()/<id>: images/, database.db, sparse/, masks
    QString m_exportDir;      // BuildsRoot()/<id>_out: Brush's .ply exports
    QStringList m_colmapMaskArgs;
    Prepared m_prepared;

    bool m_running = false;
    std::atomic_bool m_cancelled{ false }; // also read by the worker threads (probes, copy loop, save)
    // Set by the save worker once the model is in the output folder; cleared when its done() runs.
    // If the build is destroyed (app quit) before then, the destructor deletes it: quitting keeps nothing.
    QString m_unclaimedResult;
    bool m_timedOut = false;
    JobStatus m_status;
    QFile m_log;
    QString m_lastLine;       // last thing a tool printed, added to its error message
    QString m_scriptError;    // "ERROR: ..." from one of the Python scripts
    QByteArray m_lineBuffer;
    QPointer<QProcess> m_process;
    QPointer<QThread> m_worker;
    QTimer* m_timeout = nullptr;
};
