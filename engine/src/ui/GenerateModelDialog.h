/*!************************************************************************
\file GenerateModelDialog.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
Declares GenerateModelDialog, the engine's counterpart of the web app's
capture / Frame Extractor screens: the user picks photos (or videos / GIFs),
names the model, chooses the detail level and background removal, and what
happens with the finished model (import it into the scene, and / or also
save a Wavefront .obj). The model is built on this PC by
LocalReconstruction (COLMAP + Brush), so no server or sign-in is needed;
this only collects the request and checks that this PC has the tools to
build it. Remembers the last choices.
**************************************************************************/
#pragma once

#include "pipeline/GenerationTypes.h"
#include "pipeline/LocalReconstruction.h"

#include <QDialog>

class QCheckBox;
class QComboBox;
class QDoubleSpinBox;
class QLabel;
class QLineEdit;
class QListWidget;
class QPushButton;
class QSpinBox;

// What to do with the model once it has been built. The .ply is always saved in copyFolder.
struct GenerationFollowUp {
    // Saved in QSettings; the numbers match the server-build dialog's (where 1 was a .ply copy).
    enum class Copy {
        None = 0,
        ObjPoints = 2, // .obj, one coloured vertex per splat
        ObjMesh = 3    // .obj, one small coloured ellipsoid per splat
    };
    bool importIntoScene = true;
    Copy copy = Copy::None;
    QString copyFolder; // where the .ply (and any .obj) go, named after the model
};

class GenerateModelDialog : public QDialog {
    Q_OBJECT

public:
    explicit GenerateModelDialog(QWidget* parent = nullptr);

    GenerationRequest request() const;
    GenerationFollowUp followUp() const;

    void accept() override; // also saves the choices for next time

private:
    void addFiles();
    void addFolder();
    void addPaths(const QStringList& paths);
    void removeSelected();
    void onSourceChanged();
    void updateControls();
    void browseCopyFolder();
    bool isMedia() const;

    LocalReconstruction::Tools m_tools; // looked up once, when the dialog opens
    QLabel* m_toolsHint = nullptr;
    QComboBox* m_source = nullptr;
    QListWidget* m_files = nullptr;
    QPushButton* m_addFiles = nullptr;
    QPushButton* m_addFolder = nullptr;
    QPushButton* m_remove = nullptr;
    QPushButton* m_clear = nullptr;
    QLabel* m_fileCount = nullptr;
    QLineEdit* m_name = nullptr;
    QComboBox* m_detail = nullptr;
    QSpinBox* m_customIters = nullptr; // shown when Detail is "Custom..."
    QDoubleSpinBox* m_fps = nullptr;
    QLabel* m_fpsLabel = nullptr;
    QCheckBox* m_removeBackground = nullptr;
    QCheckBox* m_import = nullptr;
    QComboBox* m_copy = nullptr;
    QLineEdit* m_copyFolder = nullptr;
    QPushButton* m_browseCopyFolder = nullptr;
    QPushButton* m_generate = nullptr;
};
