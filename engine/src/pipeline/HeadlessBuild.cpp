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

#include "pipeline/LocalReconstruction.h"

#include <QCoreApplication>
#include <QDir>
#include <QDirIterator>
#include <QEventLoop>
#include <QFileInfo>
#include <QStandardPaths>

#include <cstdio>

namespace {
    void Print(const QString& text) {
        std::fputs(text.toLocal8Bit().constData(), stdout);
        std::fputs("\n", stdout);
        std::fflush(stdout);
    }

    const QStringList kPhotoSuffixes = { "jpg", "jpeg", "png" };
}

bool IsHeadlessBuild(const QStringList& args) {
    return args.contains("--build-model");
}

int RunHeadlessBuild(const QStringList& args) {
    GenerationRequest request;
    request.trainIters = 7000;
    QString outFolder = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + "/Genesis Models";

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
            for (const QString& suffix : kPhotoSuffixes) patterns << "*." + suffix;
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
              "[--name <name>] [--iters <n>] [--fps <n>] [--remove-background]");
        return 2;
    }
    const bool media = !kPhotoSuffixes.contains(QFileInfo(request.files.front()).suffix().toLower());
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
