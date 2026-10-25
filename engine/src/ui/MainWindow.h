/*!************************************************************************
\file MainWindow.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 01-10-2026
\brief
Declares MainWindow, the editor shell. It hosts the 3D Viewport in the
centre and arranges the editor around it: menu bar, main toolbar, status
bar, and the dockable Scene (outliner), Inspector, Assets, Console and
Audio panels. It owns the scene-editing commands (import, select, rename,
delete, render mode, export), loads .ply files and writes exports on
worker threads, accepts .ply
drag-and-drop, and persists layout and preferences with QSettings.
**************************************************************************/
#pragma once

#include <QByteArray>
#include <QElapsedTimer>
#include <QMainWindow>
#include <QPointer>
#include <QStringList>

#include <vector>

class QAction;
class QActionGroup;
class QDockWidget;
class QLabel;
class QMenu;
class QProgressBar;
class QThread;
class QToolBar;

#include "splat/SplatTrimmer.h"

struct SplatVertex;

class AssetBrowserPanel;
class AudioPanel;
class ConsolePanel;
class InspectorPanel;
class OutlinerPanel;
class Viewport;

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    MainWindow();
    ~MainWindow() override;

    // Imports each .ply in paths (e.g. from the command line). Safe to call
    // before the window is shown; loading starts once the renderer exists.
    void openFiles(const QStringList& paths);

protected:
    void closeEvent(QCloseEvent* event) override;
    void dragEnterEvent(QDragEnterEvent* event) override;
    void dropEvent(QDropEvent* event) override;

private:
    // ---- construction ----
    void createActions();
    void createMenus();
    void createToolBar();
    void createDocks();
    void createStatusBar();
    QDockWidget* addPanelDock(const QString& title, const QString& objectName,
                              QWidget* panel, Qt::DockWidgetArea area);

    // ---- persistence ----
    void restoreSettings();
    void saveSettings() const;

    // ---- scene commands ----
    // Queues a .ply for import; files load one at a time on a worker thread.
    void importSplat(const QString& path);
    void startNextImport();
    // `original` holds the untrimmed data, or is empty if the import was not trimmed.
    // `trimData` is the values the import was trimmed with (stored on the model).
    void finishImport(const QString& path, std::vector<SplatVertex>& splats, std::vector<SplatVertex>& original,
                      const TrimData& trimData);
    void showTrimDialog();
    void applyDefaultTrim(const TrimData& trim);   // saves the global defaults used for new imports
    void applyModelTrim(const TrimData& trim);     // re-trims the selected model and stores the values on it
    void untrimModel();                            // restores the selected model's original splats
    void selectModel(int index);
    void renameModel(int index, const QString& name);
    void deleteSelectedModel();
    void toggleModelHidden(int index);
    void setRenderMode(int mode); // SplatRenderer::RenderMode as int
    // Asks for export options and a file name, then writes the selected
    // model (or the whole scene) on a worker thread.
    void exportModels();

    // Rebuilds the outliner/inspector from the renderer and updates which
    // scene actions are enabled.
    void refreshScenePanels();
    void setImportBusy(const QString& fileName); // empty = idle

    // ---- recent files ----
    void addRecentFile(const QString& path);
    void rebuildRecentMenu();

    // ---- help ----
    void showControls();
    void showAbout();

    Viewport* m_viewport = nullptr;

    // Panels (owned by their docks).
    OutlinerPanel* m_outliner = nullptr;
    InspectorPanel* m_inspector = nullptr;
    AssetBrowserPanel* m_assets = nullptr;
    ConsolePanel* m_console = nullptr;
    AudioPanel* m_audio = nullptr;
    QList<QDockWidget*> m_docks;
    QToolBar* m_toolBar = nullptr;

    // Actions.
    QAction* m_importAction = nullptr;
    QAction* m_exportAction = nullptr;
    QAction* m_exitAction = nullptr;
    QAction* m_renameAction = nullptr;
    QAction* m_deleteAction = nullptr;
    QAction* m_deselectAction = nullptr;
    QAction* m_toggleVisibilityAction = nullptr;
    QAction* m_resetPositionAction = nullptr;
    QActionGroup* m_renderModeGroup = nullptr;
    QAction* m_pointCloudAction = nullptr;
    QAction* m_gaussianAction = nullptr;
    QAction* m_recenterCameraAction = nullptr;
    QAction* m_statsOverlayAction = nullptr;
    QAction* m_trimOnImportAction = nullptr;
    QAction* m_trimSettingsAction = nullptr;
    TrimData m_trimSettings;
    QAction* m_resetLayoutAction = nullptr;
    QMenu* m_recentMenu = nullptr;
    QMenu* m_windowMenu = nullptr;

    // Status bar.
    QLabel* m_loadingLabel = nullptr;
    QProgressBar* m_loadingBar = nullptr;
    QLabel* m_sceneLabel = nullptr;
    QLabel* m_modeLabel = nullptr;
    QLabel* m_fpsLabel = nullptr;
    QElapsedTimer m_statsTimer;

    // Import queue / worker.
    QStringList m_pendingImports;
    QPointer<QThread> m_loadThread;
    QPointer<QThread> m_exportThread;

    QStringList m_recentFiles;
    QByteArray m_defaultLayout; // dock layout before restoring, for Reset Layout
};
