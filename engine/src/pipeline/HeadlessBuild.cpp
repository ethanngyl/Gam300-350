/*!************************************************************************
\file HeadlessBuild.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
Implements the command-line model build: parses the arguments into a
GenerationRequest, runs LocalReconstruction in an event loop and prints
each phase change to stdout.
**************************************************************************/
#include "pipeline/HeadlessBuild.h"

#include "pipeline/GenerationSettings.h"
#include "pipeline/LocalReconstruction.h"

#include <QCoreApplication>
#include <QDir>
#include <QEventLoop>
#include <QFileInfo>

#include <atomic>
#include <cstdio>

#ifdef Q_OS_WIN
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace {
    void Print(const QString& text) {
        std::fputs(text.toLocal8Bit().constData(), stdout);
        std::fputs("\n", stdout);
        std::fflush(stdout);
    }

#ifdef Q_OS_WIN
    // Whether a standard handle already goes somewhere (a file or pipe the caller redirected it to).
    bool IsRedirected(DWORD which) {
        const HANDLE handle = GetStdHandle(which);
        return handle != nullptr && handle != INVALID_HANDLE_VALUE && GetFileType(handle) != FILE_TYPE_UNKNOWN;
    }
#endif

    // The engine is linked as a Windows GUI app (WIN32_EXECUTABLE), which starts with no console,
    // so stdout goes nowhere. Borrow the console of the terminal that started it, if any. A stream
    // the caller redirected (Codefine.exe ... > build.log) is left alone.
    void AttachParentConsole() {
#ifdef Q_OS_WIN
        const bool outRedirected = IsRedirected(STD_OUTPUT_HANDLE);
        const bool errRedirected = IsRedirected(STD_ERROR_HANDLE);
        if (outRedirected && errRedirected) return;
        if (AttachConsole(ATTACH_PARENT_PROCESS)) {
            FILE* stream = nullptr;
            if (!outRedirected) freopen_s(&stream, "CONOUT$", "w", stdout);
            if (!errRedirected) freopen_s(&stream, "CONOUT$", "w", stderr);
            // cmd.exe has usually printed its prompt already; start on a fresh line.
            if (!outRedirected) std::fputs("\n", stdout);
        }
#endif
    }

#ifdef Q_OS_WIN
    // The running build, read by the console control handler. Only the main thread sets it, and
    // only the main thread dereferences it (the handler queues the cancel onto the main thread).
    std::atomic<LocalReconstruction*> g_build{ nullptr };
    std::atomic_bool g_cancelRequested{ false };
    HANDLE g_buildDone = nullptr; // set once the build has finished and cleaned up

    // Runs on a thread Windows creates for the event. COLMAP and Brush run without a console
    // (CREATE_NO_WINDOW), so they never see Ctrl+C: without this they kept running hidden on the GPU.
    BOOL WINAPI OnConsoleControl(DWORD type) {
        if (!g_build.load()) return FALSE; // nothing running: default handling (exit)
        if (g_cancelRequested.exchange(true)) {
            return FALSE; // second Ctrl+C: give up on a clean cancel and exit
        }
        QMetaObject::invokeMethod(qApp, [] {
            if (LocalReconstruction* build = g_build.load()) {
                Print("Cancelling... (press Ctrl+C again to exit without cleaning up)");
                build->cancel();
            }
        }, Qt::QueuedConnection);
        if (type == CTRL_C_EVENT || type == CTRL_BREAK_EVENT) return TRUE;
        // Window closed, logoff or shutdown: Windows ends the process as soon as this returns,
        // and allows ~5 s, so wait for the cancel to stop the tools and remove the work folders.
        if (g_buildDone) WaitForSingleObject(g_buildDone, 4500);
        return TRUE;
    }
#endif
}

bool IsHeadlessBuild(const QStringList& args) {
    return args.contains("--build-model");
}

int RunHeadlessBuild(const QStringList& args) {
    AttachParentConsole();

    GenerationRequest request;
    request.trainIters = generation::kDefaultTrainIters;
    QString outFolder = generation::DefaultOutputFolder();

    for (int i = 1; i < args.size(); ++i) {
        const QString& arg = args[i];
        const bool hasValue = i + 1 < args.size();
        if (arg == "--build-model") continue;
        if (arg == "--out" && hasValue) outFolder = args[++i];
        else if (arg == "--name" && hasValue) request.name = args[++i];
        else if (arg == "--iters" && hasValue) {
            // The same range as the dialog's spin box; the build would otherwise quietly clamp it.
            bool ok = false;
            request.trainIters = args[++i].toInt(&ok);
            if (!ok || request.trainIters < generation::kMinTrainIters || request.trainIters > generation::kMaxTrainIters) {
                Print(QString("--iters must be a whole number from %1 to %2 (got \"%3\").")
                          .arg(generation::kMinTrainIters).arg(generation::kMaxTrainIters).arg(args[i]));
                return 2;
            }
        } else if (arg == "--fps" && hasValue) {
            bool ok = false;
            request.fps = args[++i].toDouble(&ok);
            if (!ok || request.fps <= 0.0) {
                Print(QString("--fps must be a number above 0 (got \"%1\").").arg(args[i]));
                return 2;
            }
        } else if (arg == "--remove-background") request.removeBackground = true;
        else if (QFileInfo(arg).isDir()) {
            request.files << generation::PhotosInFolder(arg);
        } else if (QFileInfo(arg).isFile()) {
            request.files << QFileInfo(arg).absoluteFilePath();
        } else {
            Print("Unknown argument or missing file: " + arg);
            return 2;
        }
    }
    if (request.files.isEmpty()) {
        Print("Usage: Codefine --build-model <photo folder | photos... | videos...> [--out <folder>] "
              "[--name <name>] [--iters <n>] [--fps <n>] [--remove-background]\n"
              "From cmd.exe, use: start /b /wait \"\" Codefine.exe --build-model ... "
              "(waits for the build and sets %ERRORLEVEL%)");
        return 2;
    }
    // The same checks as the Generate Model dialog: one kind of input, and a count the build can use.
    int photos = 0;
    int videos = 0;
    for (const QString& file : request.files) {
        if (generation::IsPhotoFile(file)) ++photos;
        else if (generation::IsMediaFile(file)) ++videos;
        else {
            Print("Not a photo (.jpg/.png) or a video/GIF: " + QDir::toNativeSeparators(file));
            return 2;
        }
    }
    if (photos > 0 && videos > 0) {
        Print(QString("Give either photos or videos, not both (%1 photos, %2 videos).").arg(photos).arg(videos));
        return 2;
    }
    const bool media = videos > 0;
    if (const QString problem = generation::FileCountProblem(media, static_cast<int>(request.files.size()));
        !problem.isEmpty()) {
        Print(problem);
        return 2;
    }
    request.source = media ? GenerationRequest::Source::Media : GenerationRequest::Source::Photos;

    LocalReconstruction build;
    QEventLoop loop;
    int exitCode = 1;
    QString lastPhase;
    QObject::connect(&build, &LocalReconstruction::statusChanged, [&](const JobStatus& status) {
        if (status.phase == lastPhase && status.detail.isEmpty()) return;
        // One line per phase, and training's iteration counter as it moves.
        if (status.phase != lastPhase || status.detail.startsWith("Iteration")) {
            Print(QString("[%1%] %2%3").arg(qRound(status.progress * 100), 3).arg(status.phase,
                  status.detail.isEmpty() ? QString() : "  " + status.detail));
        }
        lastPhase = status.phase;
    });
    QObject::connect(&build, &LocalReconstruction::finished, [&](const QString& path, const QString& error) {
        if (error.isEmpty()) {
            Print("Saved " + QDir::toNativeSeparators(path));
            exitCode = 0;
        } else {
            Print("Failed: " + error);
        }
        Print("Log: " + QDir::toNativeSeparators(build.logPath()));
        loop.quit();
    });

    Print(QString("Building from %1 file(s) into %2").arg(request.files.size()).arg(QDir::toNativeSeparators(outFolder)));
#ifdef Q_OS_WIN
    g_buildDone = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    g_build = &build;
    SetConsoleCtrlHandler(OnConsoleControl, TRUE);
#endif
    build.start(request, outFolder);
    if (build.isRunning()) loop.exec();
#ifdef Q_OS_WIN
    g_build = nullptr;
    if (g_buildDone) SetEvent(g_buildDone);
    SetConsoleCtrlHandler(OnConsoleControl, FALSE);
#endif
    return exitCode;
}
