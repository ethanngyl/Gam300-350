/*!************************************************************************
\file GenerateModelDialog.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
Declares GenerateModelDialog, the engine's counterpart of the web app's
capture / Frame Extractor upload: the user picks photos (or videos / GIFs),
names the model, chooses the detail level and background removal, and what
happens with the finished model (import it into the scene, and / or save a
copy as a Gaussian splat .ply or a Wavefront .obj). The model is built
either on this PC (LocalReconstruction: COLMAP + Brush, no server) or by
the web app's backend; this only collects the request and checks that the
chosen target can take it. Remembers the last choices.
**************************************************************************/
#pragma once

#include "net/BackendClient.h"
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

// What to do with the model once the server has built it.
struct GenerationFollowUp {
    enum class Copy {
        None,
        GaussianPly, // the .ply exactly as the server made it
        ObjPoints,   // .obj, one coloured vertex per splat
        ObjMesh      // .obj, one small coloured ellipsoid per splat
    };
    bool importIntoScene = true;
    Copy copy = Copy::None;
    QString copyFolder; // where the copy goes, named after the model
};

class GenerateModelDialog : public QDialog {
    Q_OBJECT

public:
    // signedIn / server describe the web app account, for the "Build on: Server" choice.
    GenerateModelDialog(bool signedIn, const QString& server, QWidget* parent = nullptr);

    GenerationRequest request() const;
    GenerationFollowUp followUp() const;
    // Build on this PC (LocalReconstruction) rather than upload to the server.
    bool buildLocally() const;

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
    // Fills "Also save" for the chosen target: a local build always saves its .ply, so it has no .ply option.
    void fillCopyChoices();

    LocalReconstruction::Tools m_tools; // looked up once, when the dialog opens
    QComboBox* m_target = nullptr;
    QLabel* m_targetHint = nullptr;
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
