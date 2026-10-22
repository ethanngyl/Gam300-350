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

#include <QList>
#include <QWidget>

class QLabel;
class QLineEdit;
class QProgressBar;
class QPushButton;
class QTreeWidget;

class RemoteModelsPanel : public QWidget {
    Q_OBJECT

public:
    explicit RemoteModelsPanel(BackendClient* client, QWidget* parent = nullptr);

    void refresh();

signals:
    void importRequested(const QString& path);
    void signInRequested();

private:
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
};
