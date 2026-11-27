/*!************************************************************************
\file SceneFile.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 27-11-2026
\brief
Declares SaveScene and LoadScene, which write and read an editor scene.
A scene is a .gscene JSON file plus a "<name>_data" folder beside it:

  MyScene.gscene        names, transforms, hidden flags, trim values, render mode
  MyScene_data/
    model_0.ply         the model's current splats (crops and moves included)
    model_0_original.ply  the untrimmed splats, only when the model is trimmed

Splats are stored in model space as Gaussian .ply files (the format the
engine imports), and each transform is stored separately, so loading puts
every model back exactly where it was. The folder makes a scene
self-contained: it can be copied to another PC without the source files.
Both functions only use Qt Core and are safe to call from a worker thread.
**************************************************************************/
#pragma once

#include "splat/SplatData.h"
#include "splat/SplatTrimmer.h"

#include <QString>
#include <QStringList>

#include <glm/glm.hpp>

#include <string>
#include <vector>

// File extension of a scene, including the dot.
inline constexpr const char* kSceneExtension = ".gscene";

// One model as stored in a scene.
struct SceneModel {
    std::string name;
    std::vector<SplatVertex> splats;   // current splats, model space
    std::vector<SplatVertex> original; // untrimmed splats; empty unless the model is trimmed
    glm::mat4 transform = glm::mat4(1.0f);
    bool hidden = false;
    TrimData trim;        // values the model was last trimmed with
    bool trimmed = false; // true only when `original` holds the untrimmed splats
};

struct Scene {
    bool gaussianMode = true; // render mode: Gaussian Splat (true) or Point Cloud (false)
    std::vector<SceneModel> models;
};

struct SceneResult {
    bool ok = false;
    QString error;       // set when !ok
    QStringList warnings; // problems that did not stop the load (e.g. a missing model file)
};

// True if path ends in .gscene.
bool IsSceneFile(const QString& path);

// Writes scene to path (a .gscene file) and its splats to the "<name>_data"
// folder beside it, replacing an earlier save of the same scene. The old
// files are only removed once every new one has been written.
SceneResult SaveScene(const Scene& scene, const QString& path);

// Reads the scene at path into out. A model whose file is missing or
// unreadable is skipped and reported in warnings; the rest still load.
SceneResult LoadScene(const QString& path, Scene& out);
