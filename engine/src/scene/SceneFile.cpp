/*!************************************************************************
\file SceneFile.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 27-11-2026
\brief
Implements SaveScene and LoadScene (see SceneFile.h). Saving writes every
model's splats into a staging folder first, then swaps it in for the old
"<name>_data" folder and commits the .gscene file, so a failed save never
leaves a half-written scene behind. Loading checks the format and version,
then reads each model's .ply with the normal splat loader.
**************************************************************************/
#include "scene/SceneFile.h"

#include "splat/SplatExporter.h"
#include "splat/SplatLoader.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>

#include <filesystem>

namespace {
    const QString kFormat = QStringLiteral("codefine.scene");
    constexpr int kVersion = 1;

    // "<name>_data", the folder beside the .gscene that holds the splats.
    QString DataFolderName(const QString& scenePath) {
        return QFileInfo(scenePath).completeBaseName() + QStringLiteral("_data");
    }

    // Writes splats (model space, no transform) as a Gaussian .ply.
    bool WritePly(const std::vector<SplatVertex>& splats, const QString& path, QString& error) {
        ExportOptions options;
        options.format = ExportFormat::GaussianPly;
        options.minAlpha = 0.0f; // keep every splat
        const ExportResult result =
            ExportSplats({ ExportSource{ &splats, glm::mat4(1.0f) } }, std::filesystem::path(path.toStdWString()), options);
        if (!result.ok) {
            error = QString("Could not write %1: %2")
                        .arg(QDir::toNativeSeparators(path), QString::fromStdString(result.error));
        }
        return result.ok;
    }

    std::vector<SplatVertex> ReadPly(const QString& path) {
        return LoadSplatPly(QDir::toNativeSeparators(path).toLocal8Bit().toStdString());
    }

    QJsonArray MatrixToJson(const glm::mat4& m) {
        QJsonArray values; // column-major, as glm stores it
        for (int column = 0; column < 4; ++column) {
            for (int row = 0; row < 4; ++row) {
                values.append(static_cast<double>(m[column][row]));
            }
        }
        return values;
    }

    bool MatrixFromJson(const QJsonValue& value, glm::mat4& out) {
        const QJsonArray values = value.toArray();
        if (values.size() != 16) {
            return false;
        }
        for (int i = 0; i < 16; ++i) {
            if (!values[i].isDouble()) {
                return false;
            }
            out[i / 4][i % 4] = static_cast<float>(values[i].toDouble());
        }
        return true;
    }

    QJsonObject TrimToJson(const TrimData& trim) {
        return QJsonObject{
            { "minAlpha", static_cast<double>(trim.minAlpha) },
            { "cropPct", static_cast<double>(trim.cropPct) },
            { "voxelDivisions", trim.voxelDivisions },
            { "minPerVoxel", trim.minPerVoxel },
        };
    }

    TrimData TrimFromJson(const QJsonObject& object) {
        TrimData trim; // any missing value keeps its default
        trim.minAlpha = static_cast<float>(object.value("minAlpha").toDouble(trim.minAlpha));
        trim.cropPct = static_cast<float>(object.value("cropPct").toDouble(trim.cropPct));
        trim.voxelDivisions = object.value("voxelDivisions").toInt(trim.voxelDivisions);
        trim.minPerVoxel = object.value("minPerVoxel").toInt(trim.minPerVoxel);
        return trim;
    }
}

bool IsSceneFile(const QString& path) {
    return path.endsWith(QLatin1String(kSceneExtension), Qt::CaseInsensitive);
}

SceneResult SaveScene(const Scene& scene, const QString& path) {
    SceneResult result;
    const QDir sceneDir = QFileInfo(path).absoluteDir();
    const QString dataName = DataFolderName(path);
    const QString dataPath = sceneDir.filePath(dataName);
    const QString stagingPath = dataPath + QStringLiteral(".saving");
    const QString backupPath = dataPath + QStringLiteral(".old");

    // 1. Write every model into a fresh staging folder.
    QDir(stagingPath).removeRecursively(); // left over from a save that crashed
    if (!QDir().mkpath(stagingPath)) {
        result.error = QString("Could not create the folder %1.").arg(QDir::toNativeSeparators(stagingPath));
        return result;
    }

    QJsonArray models;
    for (size_t i = 0; i < scene.models.size(); ++i) {
        const SceneModel& model = scene.models[i];
        const QString fileName = QString("model_%1.ply").arg(i);
        if (!WritePly(model.splats, QDir(stagingPath).filePath(fileName), result.error)) {
            QDir(stagingPath).removeRecursively();
            return result;
        }

        QJsonObject entry{
            { "name", QString::fromStdString(model.name) },
            { "file", dataName + "/" + fileName },
            { "transform", MatrixToJson(model.transform) },
            { "hidden", model.hidden },
            { "trim", TrimToJson(model.trim) },
            { "trimmed", false },
        };
        if (model.trimmed && !model.original.empty()) {
            const QString originalName = QString("model_%1_original.ply").arg(i);
            if (!WritePly(model.original, QDir(stagingPath).filePath(originalName), result.error)) {
                QDir(stagingPath).removeRecursively();
                return result;
            }
            entry["originalFile"] = dataName + "/" + originalName;
            entry["trimmed"] = true;
        }
        models.append(entry);
    }

    const QJsonObject root{
        { "format", kFormat },
        { "version", kVersion },
        { "renderMode", scene.gaussianMode ? "splats" : "points" },
        { "models", models },
    };

    // 2. Write the .gscene to a temporary file; it replaces the old one on commit().
    QSaveFile sceneFile(path);
    if (!sceneFile.open(QIODevice::WriteOnly) ||
        sceneFile.write(QJsonDocument(root).toJson(QJsonDocument::Indented)) < 0) {
        result.error = QString("Could not write %1: %2").arg(QDir::toNativeSeparators(path), sceneFile.errorString());
        QDir(stagingPath).removeRecursively();
        return result;
    }

    // 3. Swap the staging folder in for the old data folder (kept until the end so it can be restored).
    QDir(backupPath).removeRecursively();
    const bool hadOldData = QFileInfo::exists(dataPath);
    if (hadOldData && !QDir().rename(dataPath, backupPath)) {
        result.error = QString("Could not replace %1. Close any program using it and try again.")
                           .arg(QDir::toNativeSeparators(dataPath));
        sceneFile.cancelWriting();
        QDir(stagingPath).removeRecursively();
        return result;
    }
    if (!QDir().rename(stagingPath, dataPath)) {
        result.error = QString("Could not create %1.").arg(QDir::toNativeSeparators(dataPath));
        if (hadOldData) QDir().rename(backupPath, dataPath);
        sceneFile.cancelWriting();
        QDir(stagingPath).removeRecursively();
        return result;
    }

    // 4. Commit the .gscene, then drop the old data.
    if (!sceneFile.commit()) {
        result.error = QString("Could not write %1: %2").arg(QDir::toNativeSeparators(path), sceneFile.errorString());
        QDir(dataPath).removeRecursively();
        if (hadOldData) QDir().rename(backupPath, dataPath);
        return result;
    }
    QDir(backupPath).removeRecursively();

    result.ok = true;
    return result;
}

SceneResult LoadScene(const QString& path, Scene& out) {
    SceneResult result;
    out = Scene();

    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        result.error = QString("Could not open %1: %2").arg(QDir::toNativeSeparators(path), file.errorString());
        return result;
    }
    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        result.error = QString("%1 is not a valid scene file (%2).")
                           .arg(QFileInfo(path).fileName(), parseError.errorString());
        return result;
    }

    const QJsonObject root = document.object();
    if (root.value("format").toString() != kFormat) {
        result.error = QString("%1 is not a Genesis scene file.").arg(QFileInfo(path).fileName());
        return result;
    }
    const int version = root.value("version").toInt(0);
    if (version < 1 || version > kVersion) {
        result.error = QString("%1 was saved by a newer version of the engine (scene version %2). "
                               "Update the engine to open it.")
                           .arg(QFileInfo(path).fileName())
                           .arg(version);
        return result;
    }

    out.gaussianMode = root.value("renderMode").toString("splats") != QLatin1String("points");

    const QDir sceneDir = QFileInfo(path).absoluteDir();
    const QJsonArray models = root.value("models").toArray();
    for (int i = 0; i < models.size(); ++i) {
        const QJsonObject entry = models[i].toObject();
        SceneModel model;
        model.name = entry.value("name").toString(QString("Model %1").arg(i + 1)).toStdString();
        const QString label = QString::fromStdString(model.name);

        const QString filePath = sceneDir.filePath(entry.value("file").toString());
        if (entry.value("file").toString().isEmpty() || !QFileInfo(filePath).isFile()) {
            result.warnings << QString("%1: its file %2 is missing, so it was skipped.")
                                   .arg(label, QDir::toNativeSeparators(filePath));
            continue;
        }
        model.splats = ReadPly(filePath);
        if (model.splats.empty()) {
            result.warnings << QString("%1: %2 could not be read, so it was skipped (see the Console).")
                                   .arg(label, QDir::toNativeSeparators(filePath));
            continue;
        }

        if (!MatrixFromJson(entry.value("transform"), model.transform)) {
            model.transform = glm::mat4(1.0f);
            result.warnings << QString("%1: its position was unreadable, so it was placed at the origin.").arg(label);
        }
        model.hidden = entry.value("hidden").toBool(false);
        model.trim = TrimFromJson(entry.value("trim").toObject());

        if (entry.value("trimmed").toBool(false)) {
            const QString originalPath = sceneDir.filePath(entry.value("originalFile").toString());
            if (QFileInfo(originalPath).isFile()) {
                model.original = ReadPly(originalPath);
            }
            if (model.original.empty()) {
                result.warnings << QString("%1: its untrimmed splats are missing, so the trim can't be undone.").arg(label);
            } else {
                model.trimmed = true;
            }
        }
        out.models.push_back(std::move(model));
    }

    result.ok = true;
    return result;
}
