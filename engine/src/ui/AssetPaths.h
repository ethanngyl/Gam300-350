/*!************************************************************************
\file AssetPaths.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 19-10-2026
\brief
Resolves where the engine's bundled assets and per-user data live at
runtime, so an installed copy works on machines without the source tree.
**************************************************************************/
#pragma once

#include <QCoreApplication>
#include <QDir>
#include <QStandardPaths>
#include <QString>

namespace AssetPaths {

    // Root of the bundled assets. An installed or packaged build ships them as
    // "assets" next to the exe; a dev build falls back to the source tree's
    // folder baked in by CMake. Needs a QCoreApplication to exist.
    inline QString AssetsDir() {
        const QString bundled = QCoreApplication::applicationDirPath() + "/assets";
        if (QDir(bundled).exists()) {
            return bundled;
        }
#ifdef ENGINE_ASSETS_DIR
        return QStringLiteral(ENGINE_ASSETS_DIR);
#else
        return bundled;
#endif
    }

    inline QString AssetsSubdir(const QString& name) {
        return AssetsDir() + "/" + name;
    }

    // Writable per-user folder (%APPDATA%/CoDefine/Codefine Engine on Windows),
    // created on demand. The install folder may be read-only (Program Files).
    inline QString UserDataDir() {
        const QString dir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
        QDir().mkpath(dir);
        return dir;
    }

    // Deletes all but the newest `keep` files in folder matching pattern, so per-run logs under
    // the user data folder don't pile up. The names must sort by time ("..._20261120_075751...").
    inline void PruneOldFiles(const QString& folder, const QString& pattern, int keep) {
        QDir dir(folder);
        QStringList files = dir.entryList({ pattern }, QDir::Files, QDir::Name);
        while (files.size() > keep) {
            dir.remove(files.takeFirst());
        }
    }

} // namespace AssetPaths
