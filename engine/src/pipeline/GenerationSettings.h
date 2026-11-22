/*!************************************************************************
\file GenerationSettings.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 18-11-2026
\brief
The model-generation rules shared by the Generate Model dialog, the local
build (LocalReconstruction), the command-line build (HeadlessBuild) and the
My Models panel, so they can't drift apart. Most must match the backend:
catalog.json minPhotos, config.js maxFiles / maxMediaFiles / minTrainIters /
maxTrainIters, and the photo / media file filters in middleware/uploads.js.
- kMinPhotos, kMaxPhotos, kMaxMediaFiles
- kMinTrainIters, kMaxTrainIters, kDefaultTrainIters
- kDefaultFps
- kPhotoSuffixes, kMediaSuffixes, IsPhotoFile(path), IsMediaFile(path)
- NamePatterns(suffixes), PhotosInFolder(folder)
"*.jpg"-style filters, and every photo in a folder in capture (name) order.
- FileCountProblem(media, count)
Why a set of photos or videos can't be built (too few, too many), or empty.
- DefaultOutputFolder()
Documents/Genesis Models, where new models are saved by default.
- SafeFileName(name)
A model or job name made safe to use as a file name on any OS.**************************************************************************/
#pragma once

#include <QChar>
#include <QDir>
#include <QDirIterator>
#include <QFileInfo>
#include <QStandardPaths>
#include <QString>
#include <QStringList>

namespace generation {

constexpr int kMinPhotos = 8;
constexpr int kMaxPhotos = 300;
constexpr int kMaxMediaFiles = 10;

constexpr int kMinTrainIters = 1000;
constexpr int kMaxTrainIters = 30000;
constexpr int kDefaultTrainIters = 7000; // the web app's Normal preset

// The Frame Extractor's default frames per second.
constexpr double kDefaultFps = 2.0;

inline const QStringList kPhotoSuffixes = { "jpg", "jpeg", "png" };
inline const QStringList kMediaSuffixes = { "mp4", "m4v", "mov", "webm", "mkv", "avi", "mpg", "mpeg", "gif" };

inline bool IsPhotoFile(const QString& path) {
    return kPhotoSuffixes.contains(QFileInfo(path).suffix().toLower());
}

inline bool IsMediaFile(const QString& path) {
    return kMediaSuffixes.contains(QFileInfo(path).suffix().toLower());
}

// { "jpg", "png" } -> { "*.jpg", "*.png" }, for folder scans and file dialog filters.
inline QStringList NamePatterns(const QStringList& suffixes) {
    QStringList patterns;
    for (const QString& suffix : suffixes) patterns << "*." + suffix;
    return patterns;
}

// Every photo directly in folder, sorted by name: capture order, which COLMAP matching benefits from.
inline QStringList PhotosInFolder(const QString& folder) {
    QStringList photos;
    QDirIterator it(folder, NamePatterns(kPhotoSuffixes), QDir::Files);
    while (it.hasNext()) photos << it.next();
    photos.sort(Qt::CaseInsensitive);
    return photos;
}

// Why this many photos or videos can't be built, or empty if they can. The same check for the
// dialog and the command-line build.
inline QString FileCountProblem(bool media, int count) {
    if (media && count == 0) return QStringLiteral("Add at least one video or GIF.");
    if (media && count > kMaxMediaFiles) return QString("At most %1 videos per model.").arg(kMaxMediaFiles);
    if (!media && count < kMinPhotos) return QString("Add at least %1 photos (%2 so far).").arg(kMinPhotos).arg(count);
    if (!media && count > kMaxPhotos) return QString("At most %1 photos per model.").arg(kMaxPhotos);
    return QString();
}

inline QString DefaultOutputFolder() {
    return QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation) + "/Genesis Models";
}

inline QString SafeFileName(const QString& name) {
    QString safe;
    for (const QChar c : name) {
        safe += (c < QChar(32) || QStringLiteral("<>:\"/\\|?*").contains(c)) ? QChar('_') : c;
    }
    safe = safe.trimmed().left(80).trimmed();
    while (safe.endsWith('.')) {
        safe.chop(1); // Windows drops trailing dots
    }
    // Windows reserves these device names, with or without an extension ("Con", "nul.txt", "COM1").
    // It only looks before the first dot, so "nul.txt_" would still be NUL: put the "_" in front.
    static const QStringList reserved = {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };
    if (reserved.contains(safe.section('.', 0, 0).trimmed(), Qt::CaseInsensitive)) safe.prepend('_');
    return safe;
}

} // namespace generation
