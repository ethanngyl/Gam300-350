/*!************************************************************************
\file AssetBrowserPanel.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Declares AssetBrowserPanel, the editor's "Assets" dock contents: it lists
the Gaussian-splat .ply files in a folder (name, size, date), filters them
by name, refreshes itself when the folder changes on disk, and asks for a
file to be imported on double-click / Import / context menu.
**************************************************************************/
#pragma once

#include <QWidget>

class QFileSystemWatcher;
class QLabel;
class QLineEdit;
class QPushButton;
class QTreeWidget;

class AssetBrowserPanel : public QWidget {
    Q_OBJECT

public:
    explicit AssetBrowserPanel(QWidget* parent = nullptr);

    QString folder() const { return m_folder; }
    // Lists the .ply files in dir. Empty or missing dir falls back to the
    // engine's assets/samples folder.
    void setFolder(const QString& dir);

signals:
    void importRequested(const QString& path);

private:
    void refresh();
    void applyFilter();
    void requestImportOfCurrent();

    QLabel* m_folderLabel = nullptr;
    QLineEdit* m_search = nullptr;
    QTreeWidget* m_files = nullptr;
    QPushButton* m_importButton = nullptr;
    QFileSystemWatcher* m_watcher = nullptr;
    QString m_folder;
};
