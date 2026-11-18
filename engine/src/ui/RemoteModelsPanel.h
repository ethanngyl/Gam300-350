/*!************************************************************************
\file RemoteModelsPanel.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Declares RemoteModelsPanel, the editor's "My Models" dock contents: the
models the signed-in account reconstructed through the web app (every
user's, for an admin). It lists them with status and date, filters them by
name, downloads a finished one into the account's cache (reusing an
up-to-date copy) and asks for it to be imported.
**************************************************************************/
#pragma once

#include "net/BackendClient.h"
#include "pipeline/LocalReconstruction.h"
#include "ui/GenerateModelDialog.h"

#include <QElapsedTimer>
#include <QHash>
#include <QList>
#include <QWidget>

class QLabel;
class QLineEdit;
class QProgressBar;
class QPushButton;
class QTimer;
class QTreeWidget;

class RemoteModelsPanel : public QWidget {
    Q_OBJECT

public:
    explicit RemoteModelsPanel(BackendClient* client, QWidget* parent = nullptr);

    void refresh();

    // Asks what to build (GenerateModelDialog), uploads it, follows the build
    // and, once the model is ready, downloads it and applies the follow-up
    // (import and / or save a copy). Asks to sign in first if needed.
    void showGenerateDialog();
    bool isGenerating() const;
    // A model is being built on this PC (closing the engine stops it).
    bool isBuildingLocally() const;

signals:
    void importRequested(const QString& path);
    void signInRequested();
    // A generated model has been downloaded to plyPath and the user asked for a copy of it.
    void saveCopyRequested(const QString& plyPath, const GenerationFollowUp& followUp);

private:
    // ---- generating a model ----
    void startLocalBuild(const GenerationRequest& request, const GenerationFollowUp& followUp);
    void onLocalFinished(const QString& path, const QString& error);
    // Phase, detail, elapsed time and progress of a build (server or local) on the generation row.
    void showBuildProgress(const JobStatus& status);
    void startGeneration(const GenerationRequest& request, const GenerationFollowUp& followUp);
    void onGenerationStarted(const QString& jobId);
    void onJobStatus(const JobStatus& status);
    void pollGeneration();
    void cancelGeneration();
    // Ends the build being followed; a non-empty message stays on the row until dismissed.
    void endGeneration(const QString& message);
    void resetGeneration();
    // A downloaded (or cached) model is ready: import it, or apply its generation follow-up.
    void deliver(const QString& jobId, const QString& path);

    void onSessionChanged();
    void showJobs(const QList<RemoteJob>& jobs);
    void applyFilter();
    void openCurrent();
    void open(const RemoteJob& job);
    void updateButtons();
    // Where job's model lives in the cache: <cache>/<job id>/<name>.ply
    QString cachePath(const RemoteJob& job) const;

    BackendClient* m_client = nullptr;
    QList<RemoteJob> m_jobs;

    QLabel* m_accountLabel = nullptr;
    QLineEdit* m_search = nullptr;
    QPushButton* m_refreshButton = nullptr;
    QPushButton* m_accountButton = nullptr;
    QPushButton* m_importButton = nullptr;
    QTreeWidget* m_list = nullptr;
    QLabel* m_message = nullptr;
    QProgressBar* m_progress = nullptr;
    QPushButton* m_cancelButton = nullptr;

    // Generation row: what the build is doing, its progress, and Cancel / Dismiss.
    QPushButton* m_generateButton = nullptr;
    QWidget* m_genRow = nullptr;
    QLabel* m_genLabel = nullptr;
    QProgressBar* m_genProgress = nullptr;
    QPushButton* m_genCancel = nullptr;
    QTimer* m_pollTimer = nullptr;
    LocalReconstruction* m_local = nullptr; // builds on this PC
    GenerationFollowUp m_localFollowUp;

    bool m_genUploading = false;           // upload in flight, no job id yet
    QString m_genJobId;                    // job being built and polled
    QString m_genName;                     // the name the user gave it (may be empty)
    GenerationFollowUp m_pendingFollowUp;  // for the upload in flight
    QHash<QString, GenerationFollowUp> m_followUps; // by job id, applied when its model is delivered
    QString m_autoOpenJobId;               // built, waiting for the job list so it can be downloaded
    int m_autoOpenTries = 0;               // job list requests made while waiting for m_autoOpenJobId
    bool m_pollPending = false;            // a poll (status or job list) hasn't answered yet
    QElapsedTimer m_genClock;              // since the build started on the server
};
