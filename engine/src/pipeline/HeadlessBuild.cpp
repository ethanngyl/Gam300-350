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
#include <QDirIterator>
#include <QEventLoop>
#include <QFileInfo>

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
        else if (arg == "--iters" && hasValue) request.trainIters = args[++i].toInt();
        else if (arg == "--fps" && hasValue) request.fps = args[++i].toDouble();
        else if (arg == "--remove-background") request.removeBackground = true;
        else if (QFileInfo(arg).isDir()) {
            // Every photo in the folder, in name order (capture order).
            QStringList patterns;
            for (const QString& suffix : generation::kPhotoSuffixes) patterns << "*." + suffix;
            QStringList found;
            QDirIterator it(arg, patterns, QDir::Files);
            while (it.hasNext()) found << it.next();
            found.sort(Qt::CaseInsensitive);
            request.files << found;
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
    build.start(request, outFolder);
    if (build.isRunning()) loop.exec();
    return exitCode;
}
