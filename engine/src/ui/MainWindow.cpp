/*!************************************************************************
\file MainWindow.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 01-10-2026
\brief
Implements MainWindow, the editor shell: builds the menus, toolbar, status
bar and dock panels around the Viewport; routes scene commands (import,
select, rename, delete, render mode) to the SplatRenderer and keeps the
panels in sync with it; wires the Account menu and My Models panel to
the backend; loads .ply files on a worker thread so the UI stays
responsive; and saves/restores the layout and preferences via QSettings.
**************************************************************************/
#include "ui/Viewport.h"
#include "ui/MainWindow.h"

#include "net/BackendClient.h"
#include "splat/SplatExporter.h"
#include "splat/SplatLoader.h"
#include "splat/SplatRenderer.h"
#include "splat/SplatTrimmer.h"
#include "ui/AssetBrowserPanel.h"
#include "ui/AudioPanel.h"
#include "ui/ConsolePanel.h"
#include "ui/EditCommands.h"
#include "ui/ExportDialog.h"
#include "ui/InspectorPanel.h"
#include "ui/LoginDialog.h"
#include "ui/OutlinerPanel.h"
#include "ui/RemoteModelsPanel.h"
#include "ui/TrimDialog.h"

#include <QAction>
#include <QActionGroup>
#include <QApplication>
#include <QCloseEvent>
#include <QDir>
#include <QDockWidget>
#include <QDragEnterEvent>
#include <QDropEvent>
#include <QFileDialog>
#include <QFileInfo>
#include <QLabel>
#include <QLocale>
#include <QMenu>
#include <QMenuBar>
#include <QMessageBox>
#include <QMimeData>
#include <QProgressBar>
#include <QSettings>
#include <QStatusBar>
#include <QStyle>
#include <QThread>
#include <QTimer>
#include <QToolBar>
#include <QUrl>

#include <memory>

namespace {
    // Status bar stats refresh interval, so the FPS readout is legible.
    constexpr qint64 kStatsRefreshMs = 250;

    // How long transient status bar messages stay up.
    constexpr int kStatusMessageMs = 5000;

    constexpr int kMaxRecentFiles = 8;

    // Bump when docks are added/removed/renamed so a stale saved layout is
    // ignored instead of restoring a broken arrangement.
    constexpr int kLayoutVersion = 2;

    const QString kAppTitle = QStringLiteral("Genesis Alpha Build");

    // QSettings keys.
    const QString kGeometryKey = QStringLiteral("window/geometry");
    const QString kLayoutKey = QStringLiteral("window/layout");
    const QString kAssetFolderKey = QStringLiteral("assets/folder");
    const QString kAudioFolderKey = QStringLiteral("audio/folder");
    const QString kRecentFilesKey = QStringLiteral("files/recent");
    const QString kRenderModeKey = QStringLiteral("view/renderMode");
    const QString kStatsOverlayKey = QStringLiteral("view/statsOverlay");
    const QString kTrimOnImportKey = QStringLiteral("files/trimOnImport");
    const QString kTrimAlphaKey = QStringLiteral("trim/minAlpha");
    const QString kTrimCropKey = QStringLiteral("trim/cropPct");
    const QString kTrimDivisionsKey = QStringLiteral("trim/voxelDivisions");
    const QString kTrimMinPerVoxelKey = QStringLiteral("trim/minPerVoxel");
    const QString kExportFolderKey = QStringLiteral("files/exportFolder");

    bool IsPlyFile(const QString& path) {
        return path.endsWith(".ply", Qt::CaseInsensitive);
    }

    QString RenderModeName(SplatRenderer::RenderMode mode) {
        return mode == SplatRenderer::RenderMode::GaussianSplat ? "Gaussian Splat" : "Point Cloud";
    }
}

MainWindow::MainWindow() {
    setWindowTitle(kAppTitle);
    resize(1440, 860);
    setAcceptDrops(true);
    setDockOptions(AnimatedDocks | AllowNestedDocks | AllowTabbedDocks | GroupedDragging);
    setTabPosition(Qt::AllDockWidgetAreas, QTabWidget::North);

    // The console goes first so it captures output from everything built after it.
    m_console = new ConsolePanel(this);

    m_backend = new BackendClient(this);

    m_viewport = new Viewport(this);
    setCentralWidget(m_viewport);

    createActions();
    createMenus();
    createToolBar();
    createDocks();
    createStatusBar();

    m_defaultLayout = saveState(kLayoutVersion);
    restoreSettings();

    // A finished gizmo drag becomes one undo step.
    m_viewport->onTransformEdited = [this](SplatModel* model, const glm::mat4& before, const glm::mat4& after) {
        m_undo.push(new MoveModelCommand(model, before, after));
    };

    // The renderer only exists once the GL context does (first show).
    m_viewport->onInitialized = [this] {
        setRenderMode(m_gaussianAction->isChecked()
                          ? static_cast<int>(SplatRenderer::RenderMode::GaussianSplat)
                          : static_cast<int>(SplatRenderer::RenderMode::PointCloud));
        m_viewport->setShowImGuiStats(m_statsOverlayAction->isChecked());
        refreshScenePanels();
        startNextImport(); // anything queued before the renderer existed
        qInfo("Renderer ready. Import a .ply to get started.");
    };

    m_statsTimer.start();
    m_viewport->onStats = [this](float fps, std::size_t splatCount) {
        // Picks up WASD nudges made in the viewport. Cheap, so every frame.
        m_inspector->syncFromModel();

        if (m_statsTimer.elapsed() < kStatsRefreshMs) {
            return;
        }
        m_statsTimer.restart();
        const SplatRenderer* renderer = m_viewport->renderer();
        m_fpsLabel->setText(QString("%1 FPS").arg(fps, 0, 'f', 1));
        m_sceneLabel->setText(QString("%1 model%2  |  %3 splats")
                                  .arg(renderer->ModelCount())
                                  .arg(renderer->ModelCount() == 1 ? "" : "s")
                                  .arg(QLocale().toString(static_cast<qulonglong>(splatCount))));
    };

    // Resume a remembered web app session (quietly does nothing without one).
    connect(m_backend, &BackendClient::sessionChanged, this, [this] { updateAccountActions(); });
    updateAccountActions();
    m_backend->restoreSession();

    m_viewport->setFocus();
}

MainWindow::~MainWindow() {
    // Never destroy a running QThread: wait for an in-flight import or export to finish.
    for (QThread* thread : { m_loadThread.data(), m_exportThread.data() }) {
        if (thread) {
            thread->wait();
            delete thread;
        }
    }
}

// ===========================================================================
// Construction
// ===========================================================================

void MainWindow::createActions() {
    QStyle* s = style();

    m_importAction = new QAction(s->standardIcon(QStyle::SP_DialogOpenButton), "&Import Splat...", this);
    m_importAction->setShortcut(QKeySequence::Open);
    m_importAction->setStatusTip("Load a Gaussian-splat .ply file into the scene");
    connect(m_importAction, &QAction::triggered, this, [this] {
        const QStringList paths = QFileDialog::getOpenFileNames(
            this, "Import Gaussian Splat", m_assets ? m_assets->folder() : QString(),
            "Gaussian splat (*.ply);;All files (*.*)");
        for (const QString& path : paths) {
            importSplat(path);
        }
    });

    m_exportAction = new QAction(s->standardIcon(QStyle::SP_DialogSaveButton), "&Export...", this);
    m_exportAction->setShortcut(QKeySequence("Ctrl+E"));
    m_exportAction->setStatusTip("Convert the selected model or the whole scene to .glb, .obj, .ply, .stl or .splat");
    m_exportAction->setEnabled(false); // until a model is loaded
    connect(m_exportAction, &QAction::triggered, this, [this] { exportModels(); });

    m_exitAction = new QAction("E&xit", this);
    m_exitAction->setShortcut(QKeySequence("Ctrl+Q"));
    connect(m_exitAction, &QAction::triggered, this, &QWidget::close);

    m_renameAction = new QAction("&Rename", this);
    m_renameAction->setShortcut(QKeySequence("F2"));
    connect(m_renameAction, &QAction::triggered, this, [this] {
        if (QDockWidget* dock = qobject_cast<QDockWidget*>(m_outliner->parentWidget())) {
            dock->show();
            dock->raise();
        }
        m_outliner->editSelectedName();
    });

    m_deleteAction = new QAction(s->standardIcon(QStyle::SP_TrashIcon), "&Delete", this);
    m_deleteAction->setShortcut(QKeySequence::Delete);
    m_deleteAction->setStatusTip("Remove the selected model from the scene (the file is not touched)");
    connect(m_deleteAction, &QAction::triggered, this, [this] { deleteSelectedModel(); });

    m_toggleVisibilityAction = new QAction("Hide/Show &Model", this);
    m_toggleVisibilityAction->setShortcut(QKeySequence("Ctrl+H"));
    m_toggleVisibilityAction->setStatusTip("Hide or show the selected model without removing it");
    connect(m_toggleVisibilityAction, &QAction::triggered, this, [this] {
        if (SplatRenderer* renderer = m_viewport->renderer()) {
            toggleModelHidden(renderer->GetSelectedModel());
        }
    });

    // Esc and Home act on the viewport only, so they never steal keys from
    // text fields or lists in the panels.
    m_deselectAction = new QAction("D&eselect", this);
    m_deselectAction->setShortcut(QKeySequence(Qt::Key_Escape));
    m_deselectAction->setShortcutContext(Qt::WidgetShortcut);
    m_viewport->addAction(m_deselectAction);
    connect(m_deselectAction, &QAction::triggered, this, [this] { selectModel(-1); refreshScenePanels(); });

    m_resetPositionAction = new QAction("Reset &Position", this);
    connect(m_resetPositionAction, &QAction::triggered, this, [this] {
        SplatRenderer* renderer = m_viewport->renderer();
        SplatModel* model = renderer ? renderer->GetModel(renderer->GetSelectedModel()) : nullptr;
        if (!model) return;
        glm::mat4 transform = model->GetTransform();
        transform[3] = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
        if (transform != model->GetTransform()) {
            m_undo.push(new MoveModelCommand(model, model->GetTransform(), transform));
        }
    });

    // Text follows the top command ("Undo Move Cube"); disabled when the stack is empty.
    m_undoAction = m_undo.createUndoAction(this, "&Undo");
    m_undoAction->setShortcut(QKeySequence::Undo);
    m_redoAction = m_undo.createRedoAction(this, "&Redo");
    m_redoAction->setShortcut(QKeySequence::Redo);

    m_renderModeGroup = new QActionGroup(this);
    m_renderModeGroup->setExclusive(true);
    m_pointCloudAction = new QAction("&Point Cloud", m_renderModeGroup);
    m_pointCloudAction->setCheckable(true);
    m_pointCloudAction->setShortcut(QKeySequence("Ctrl+1"));
    m_pointCloudAction->setStatusTip("Draw each splat as a flat round point (fast)");
    m_gaussianAction = new QAction("&Gaussian Splat", m_renderModeGroup);
    m_gaussianAction->setCheckable(true);
    m_gaussianAction->setShortcut(QKeySequence("Ctrl+2"));
    m_gaussianAction->setStatusTip("Draw oriented, depth-sorted Gaussian ellipses (accurate)");
    m_pointCloudAction->setChecked(true);
    connect(m_pointCloudAction, &QAction::triggered, this,
            [this] { setRenderMode(static_cast<int>(SplatRenderer::RenderMode::PointCloud)); });
    connect(m_gaussianAction, &QAction::triggered, this,
            [this] { setRenderMode(static_cast<int>(SplatRenderer::RenderMode::GaussianSplat)); });

    m_recenterCameraAction = new QAction(s->standardIcon(QStyle::SP_BrowserReload), "&Recenter Camera", this);
    m_recenterCameraAction->setShortcut(QKeySequence(Qt::Key_Home));
    m_recenterCameraAction->setShortcutContext(Qt::WidgetShortcut);
    m_recenterCameraAction->setStatusTip("Move the camera's pan target back to the origin");
    m_viewport->addAction(m_recenterCameraAction);
    connect(m_recenterCameraAction, &QAction::triggered, this, [this] { m_viewport->recenterCamera(); });

    m_statsOverlayAction = new QAction("Stats &Overlay", this);
    m_statsOverlayAction->setCheckable(true);
    m_statsOverlayAction->setChecked(true);
    m_statsOverlayAction->setStatusTip("Show the FPS / splat count overlay in the viewport");
    connect(m_statsOverlayAction, &QAction::toggled, this, [this](bool on) { m_viewport->setShowImGuiStats(on); });

    m_trimOnImportAction = new QAction("&Trim Splats on Import", this);
    m_trimOnImportAction->setCheckable(true);
    m_trimOnImportAction->setChecked(true);
    m_trimOnImportAction->setStatusTip("Remove faint, stray and out-of-range splats when importing. "
                                       "Uncheck to import the original data untouched.");

    m_accountInfoAction = new QAction(this);
    m_accountInfoAction->setEnabled(false); // a label, not a command

    m_signInAction = new QAction("Sign &In...", this);
    m_signInAction->setStatusTip("Sign in with your web app account to open the models you uploaded");
    connect(m_signInAction, &QAction::triggered, this, [this] { showSignIn(); });

    m_signOutAction = new QAction("Sign &Out", this);
    m_signOutAction->setStatusTip("Sign out and delete this account's downloaded models from this PC");
    connect(m_signOutAction, &QAction::triggered, this, [this] { m_backend->signOut(); });

    m_trimSettingsAction = new QAction("Trim &Settings...", this);
    m_trimSettingsAction->setStatusTip("Edit the default splat trim values used for new imports");
    connect(m_trimSettingsAction, &QAction::triggered, this, [this] { showTrimDialog(); });

    m_resetLayoutAction = new QAction("&Reset Layout", this);
    connect(m_resetLayoutAction, &QAction::triggered, this, [this] {
        restoreState(m_defaultLayout, kLayoutVersion);
    });
}

void MainWindow::createMenus() {
    QMenu* fileMenu = menuBar()->addMenu("&File");
    fileMenu->addAction(m_importAction);
    fileMenu->addAction(m_trimOnImportAction);
    m_recentMenu = fileMenu->addMenu("Open &Recent");
    fileMenu->addSeparator();
    fileMenu->addAction(m_exportAction);
    fileMenu->addSeparator();
    fileMenu->addAction(m_exitAction);

    QMenu* editMenu = menuBar()->addMenu("&Edit");
    editMenu->addAction(m_undoAction);
    editMenu->addAction(m_redoAction);
    editMenu->addSeparator();
    editMenu->addAction(m_renameAction);
    editMenu->addAction(m_deleteAction);
    editMenu->addAction(m_toggleVisibilityAction);
    editMenu->addSeparator();
    editMenu->addAction(m_resetPositionAction);
    editMenu->addAction(m_deselectAction);
    editMenu->addSeparator();
    editMenu->addAction(m_trimSettingsAction);

    QMenu* viewMenu = menuBar()->addMenu("&View");
    QMenu* renderModeMenu = viewMenu->addMenu("Render &Mode");
    renderModeMenu->addAction(m_pointCloudAction);
    renderModeMenu->addAction(m_gaussianAction);
    viewMenu->addSeparator();
    viewMenu->addAction(m_recenterCameraAction);
    viewMenu->addAction(m_statsOverlayAction);

    QMenu* accountMenu = menuBar()->addMenu("&Account");
    accountMenu->addAction(m_accountInfoAction);
    accountMenu->addSeparator();
    accountMenu->addAction(m_signInAction);
    accountMenu->addAction(m_signOutAction);

    // Filled in createDocks() once the docks exist.
    m_windowMenu = menuBar()->addMenu("&Window");

    QMenu* helpMenu = menuBar()->addMenu("&Help");
    helpMenu->addAction("&Controls", QKeySequence::HelpContents, this, [this] { showControls(); });
    helpMenu->addSeparator();
    helpMenu->addAction("&About Genesis Alpha Build", this, [this] { showAbout(); });
    helpMenu->addAction("About &Qt", qApp, &QApplication::aboutQt);
}

void MainWindow::createToolBar() {
    m_toolBar = addToolBar("Main Toolbar");
    m_toolBar->setObjectName("MainToolBar");
    m_toolBar->setMovable(false);
    m_toolBar->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);

    m_toolBar->addAction(m_importAction);
    m_toolBar->addAction(m_exportAction);
    m_toolBar->addSeparator();

    auto* modeLabel = new QLabel("  Render: ", m_toolBar);
    modeLabel->setObjectName("PanelHint");
    m_toolBar->addWidget(modeLabel);
    m_toolBar->addAction(m_pointCloudAction);
    m_toolBar->addAction(m_gaussianAction);
    m_toolBar->addSeparator();

    m_toolBar->addAction(m_recenterCameraAction);
    m_toolBar->addAction(m_statsOverlayAction);
    m_toolBar->addSeparator();
    m_toolBar->addAction(m_deleteAction);
}

QDockWidget* MainWindow::addPanelDock(const QString& title, const QString& objectName,
                                      QWidget* panel, Qt::DockWidgetArea area) {
    auto* dock = new QDockWidget(title, this);
    dock->setObjectName(objectName); // required by saveState/restoreState
    dock->setWidget(panel);
    addDockWidget(area, dock);
    m_docks.append(dock);
    return dock;
}

void MainWindow::createDocks() {
    // Side panels run the full window height; the bottom area sits under the viewport.
    setCorner(Qt::TopLeftCorner, Qt::LeftDockWidgetArea);
    setCorner(Qt::BottomLeftCorner, Qt::LeftDockWidgetArea);
    setCorner(Qt::TopRightCorner, Qt::RightDockWidgetArea);
    setCorner(Qt::BottomRightCorner, Qt::RightDockWidgetArea);

    m_outliner = new OutlinerPanel(this);
    QDockWidget* sceneDock = addPanelDock("Scene", "SceneDock", m_outliner, Qt::LeftDockWidgetArea);

    m_inspector = new InspectorPanel(this);
    QDockWidget* inspectorDock = addPanelDock("Inspector", "InspectorDock", m_inspector, Qt::RightDockWidgetArea);

    m_assets = new AssetBrowserPanel(this);
    QDockWidget* assetsDock = addPanelDock("Assets", "AssetsDock", m_assets, Qt::BottomDockWidgetArea);

    m_remoteModels = new RemoteModelsPanel(m_backend, this);
    QDockWidget* modelsDock = addPanelDock("My Models", "MyModelsDock", m_remoteModels, Qt::BottomDockWidgetArea);

    QDockWidget* consoleDock = addPanelDock("Console", "ConsoleDock", m_console, Qt::BottomDockWidgetArea);

    m_audio = new AudioPanel(this);
    QDockWidget* audioDock = addPanelDock("Audio", "AudioDock", m_audio, Qt::BottomDockWidgetArea);

    tabifyDockWidget(assetsDock, modelsDock);
    tabifyDockWidget(modelsDock, consoleDock);
    tabifyDockWidget(consoleDock, audioDock);
    assetsDock->raise();

    resizeDocks({ sceneDock, inspectorDock }, { 260, 300 }, Qt::Horizontal);
    resizeDocks({ assetsDock }, { 230 }, Qt::Vertical);

    // Window menu: a show/hide toggle per panel, plus layout reset.
    for (QDockWidget* dock : m_docks) {
        m_windowMenu->addAction(dock->toggleViewAction());
    }
    m_windowMenu->addSeparator();
    m_windowMenu->addAction(m_toolBar->toggleViewAction());
    m_windowMenu->addSeparator();
    m_windowMenu->addAction(m_resetLayoutAction);

    // Panel -> scene commands.
    connect(m_assets, &AssetBrowserPanel::importRequested, this, &MainWindow::importSplat);
    connect(m_remoteModels, &RemoteModelsPanel::importRequested, this, &MainWindow::importSplat);
    connect(m_remoteModels, &RemoteModelsPanel::signInRequested, this, [this] { showSignIn(); });
    connect(m_outliner, &OutlinerPanel::selectionChanged, this, &MainWindow::selectModel);
    connect(m_outliner, &OutlinerPanel::renameRequested, this, &MainWindow::renameModel);
    connect(m_outliner, &OutlinerPanel::deleteRequested, this, [this](int index) {
        selectModel(index);
        deleteSelectedModel();
    });
    connect(m_outliner, &OutlinerPanel::toggleHiddenRequested, this, &MainWindow::toggleModelHidden);
    connect(m_outliner, &OutlinerPanel::exportRequested, this, [this](int index) {
        selectModel(index);
        exportModels();
    });
    connect(m_inspector, &InspectorPanel::trimApplyRequested, this, &MainWindow::applyModelTrim);
    connect(m_inspector, &InspectorPanel::untrimRequested, this, &MainWindow::untrimModel);
    connect(m_inspector, &InspectorPanel::nameChanged, this, [this](const QString& name) {
        if (SplatRenderer* renderer = m_viewport->renderer()) {
            renameModel(renderer->GetSelectedModel(), name);
        }
    });
}

void MainWindow::createStatusBar() {
    m_loadingLabel = new QLabel(this);
    m_loadingBar = new QProgressBar(this);
    m_loadingBar->setRange(0, 0); // indeterminate: happly gives no progress
    m_loadingBar->setMaximumWidth(140);
    m_loadingBar->setMaximumHeight(14);
    m_loadingBar->setTextVisible(false);
    m_sceneLabel = new QLabel("0 models", this);
    m_modeLabel = new QLabel(this);
    m_fpsLabel = new QLabel(this);
    m_fpsLabel->setMinimumWidth(70);

    statusBar()->addPermanentWidget(m_loadingLabel);
    statusBar()->addPermanentWidget(m_loadingBar);
    statusBar()->addPermanentWidget(m_sceneLabel);
    statusBar()->addPermanentWidget(m_modeLabel);
    statusBar()->addPermanentWidget(m_fpsLabel);

    setImportBusy(QString());
    m_modeLabel->setText(RenderModeName(SplatRenderer::RenderMode::PointCloud));
}

// ===========================================================================
// Persistence
// ===========================================================================

void MainWindow::restoreSettings() {
    QSettings settings;
    restoreGeometry(settings.value(kGeometryKey).toByteArray());
    restoreState(settings.value(kLayoutKey).toByteArray(), kLayoutVersion);

    m_assets->setFolder(settings.value(kAssetFolderKey).toString());
    m_audio->setFolder(settings.value(kAudioFolderKey).toString());

    const bool gaussian = settings.value(kRenderModeKey).toInt() ==
                          static_cast<int>(SplatRenderer::RenderMode::GaussianSplat);
    (gaussian ? m_gaussianAction : m_pointCloudAction)->setChecked(true);
    m_statsOverlayAction->setChecked(settings.value(kStatsOverlayKey, true).toBool());
    m_trimOnImportAction->setChecked(settings.value(kTrimOnImportKey, true).toBool());
    m_trimSettings.minAlpha = settings.value(kTrimAlphaKey, m_trimSettings.minAlpha).toFloat();
    m_trimSettings.cropPct = settings.value(kTrimCropKey, m_trimSettings.cropPct).toFloat();
    m_trimSettings.voxelDivisions = settings.value(kTrimDivisionsKey, m_trimSettings.voxelDivisions).toInt();
    m_trimSettings.minPerVoxel = settings.value(kTrimMinPerVoxelKey, m_trimSettings.minPerVoxel).toInt();
    m_inspector->setDefaultTrim(m_trimSettings);

    m_recentFiles = settings.value(kRecentFilesKey).toStringList();
    rebuildRecentMenu();
}

void MainWindow::saveSettings() const {
    QSettings settings;
    settings.setValue(kGeometryKey, saveGeometry());
    settings.setValue(kLayoutKey, saveState(kLayoutVersion));
    settings.setValue(kAssetFolderKey, m_assets->folder());
    settings.setValue(kAudioFolderKey, m_audio->folder());
    settings.setValue(kRenderModeKey, m_gaussianAction->isChecked()
                                          ? static_cast<int>(SplatRenderer::RenderMode::GaussianSplat)
                                          : static_cast<int>(SplatRenderer::RenderMode::PointCloud));
    settings.setValue(kStatsOverlayKey, m_statsOverlayAction->isChecked());
    settings.setValue(kTrimOnImportKey, m_trimOnImportAction->isChecked());
    settings.setValue(kTrimAlphaKey, m_trimSettings.minAlpha);
    settings.setValue(kTrimCropKey, m_trimSettings.cropPct);
    settings.setValue(kTrimDivisionsKey, m_trimSettings.voxelDivisions);
    settings.setValue(kTrimMinPerVoxelKey, m_trimSettings.minPerVoxel);
    settings.setValue(kRecentFilesKey, m_recentFiles);
}

void MainWindow::closeEvent(QCloseEvent* event) {
    saveSettings();
    m_pendingImports.clear(); // don't start anything new while shutting down
    QMainWindow::closeEvent(event);
}

// ===========================================================================
// Drag and drop: .ply files dropped anywhere on the window are imported.
// ===========================================================================

void MainWindow::dragEnterEvent(QDragEnterEvent* event) {
    if (!event->mimeData()->hasUrls()) {
        return;
    }
    for (const QUrl& url : event->mimeData()->urls()) {
        if (url.isLocalFile() && IsPlyFile(url.toLocalFile())) {
            event->acceptProposedAction();
            return;
        }
    }
}

void MainWindow::dropEvent(QDropEvent* event) {
    for (const QUrl& url : event->mimeData()->urls()) {
        if (url.isLocalFile() && IsPlyFile(url.toLocalFile())) {
            importSplat(url.toLocalFile());
        }
    }
    event->acceptProposedAction();
}

// ===========================================================================
// Scene commands
// ===========================================================================

void MainWindow::openFiles(const QStringList& paths) {
    for (const QString& path : paths) {
        if (IsPlyFile(path)) {
            importSplat(path);
        } else {
            qWarning("Ignoring '%s': only .ply files can be opened.", qPrintable(path));
        }
    }
}

void MainWindow::importSplat(const QString& path) {
    if (!QFileInfo(path).isFile()) {
        qWarning("Import failed: '%s' does not exist.", qPrintable(QDir::toNativeSeparators(path)));
        QMessageBox::warning(this, "Import Failed",
                             QString("The file could not be found:\n%1").arg(QDir::toNativeSeparators(path)));
        m_recentFiles.removeAll(path);
        rebuildRecentMenu();
        return;
    }
    m_pendingImports.append(path);
    startNextImport();
}

void MainWindow::startNextImport() {
    SplatRenderer* renderer = m_viewport->renderer();
    if (m_loadThread || m_pendingImports.isEmpty() || !renderer) {
        return; // busy (picked up when the current load finishes), idle, or GL not ready
    }

    // Count queued files against the shader's fixed-size transform array too.
    if (renderer->ModelCount() >= static_cast<size_t>(SplatRenderer::kMaxModels)) {
        const int skipped = m_pendingImports.size();
        m_pendingImports.clear();
        qWarning("Import skipped: the scene already holds the maximum of %d models.", SplatRenderer::kMaxModels);
        QMessageBox::warning(this, "Scene Full",
                             QString("The scene already holds the maximum of %1 models, so %2 file%3 "
                                     "could not be imported.\nDelete a model to make room.")
                                 .arg(SplatRenderer::kMaxModels).arg(skipped).arg(skipped == 1 ? "" : "s"));
        return;
    }

    const QString path = m_pendingImports.takeFirst();
    const QString fileName = QFileInfo(path).fileName();
    qInfo("Importing %s...", qPrintable(QDir::toNativeSeparators(path)));
    setImportBusy(fileName);

    // Parse on a worker thread: large scans take seconds and must not freeze
    // the editor. The renderer is only touched back on the GUI thread.
    auto splats = std::make_shared<std::vector<SplatVertex>>();
    const std::string nativePath = QDir::toNativeSeparators(path).toLocal8Bit().toStdString();
    auto original = std::make_shared<std::vector<SplatVertex>>(); // filled only when trimmed
    const bool trim = m_trimOnImportAction->isChecked();
    const TrimData trimSettings = m_trimSettings;
    m_loadThread = QThread::create([splats, original, nativePath, trim, trimSettings] {
        *splats = LoadSplatPly(nativePath);
        if (trim && !splats->empty()) {
            std::vector<SplatVertex> trimmed = TrimSplats(*splats, trimSettings);
            if (!trimmed.empty() && trimmed.size() < splats->size()) { // never trim a scene down to nothing
                *original = std::move(*splats);
                *splats = std::move(trimmed);
            }
        }
    });
    connect(m_loadThread, &QThread::finished, this, [this, splats, original, path, trimSettings] {
        m_loadThread->deleteLater();
        m_loadThread = nullptr;
        finishImport(path, *splats, *original, trimSettings);
        startNextImport();
    });
    m_loadThread->start();
}

void MainWindow::finishImport(const QString& path, std::vector<SplatVertex>& splats,
                              std::vector<SplatVertex>& original, const TrimData& trimData) {
    setImportBusy(m_pendingImports.isEmpty() ? QString() : QFileInfo(m_pendingImports.front()).fileName());

    const QString fileName = QFileInfo(path).fileName();
    SplatRenderer* renderer = m_viewport->renderer();
    if (splats.empty()) {
        // SplatLoader already printed the reason to std::cerr (shown in the Console).
        statusBar()->showMessage(QString("Failed to import %1 - see the Console for details.").arg(fileName),
                                 kStatusMessageMs);
        QMessageBox::warning(this, "Import Failed",
                             QString("No splats could be loaded from %1.\n\nThe file must be a 3D Gaussian "
                                     "Splatting .ply (x/y/z, scale_*, rot_*, opacity, f_dc_*). "
                                     "See the Console panel for details.").arg(fileName));
        return;
    }

    const size_t count = splats.size();
    const size_t originalCount = original.empty() ? count : original.size();
    renderer->SetSplats(splats, fileName.toStdString());
    // Downloaded models are deleted on sign-out, so they don't belong in Recent.
    if (!BackendClient::IsCachedModel(path)) {
        addRecentFile(path);
    }
    SplatModel* imported = renderer->GetModel(static_cast<int>(renderer->ModelCount()) - 1);
    const bool wasTrimmed = !original.empty();
    if (wasTrimmed) {
        imported->SetOriginal(std::move(original));
    }
    imported->SetTrimData(trimData, wasTrimmed);
    addRecentFile(path);

    selectModel(static_cast<int>(renderer->ModelCount()) - 1);
    refreshScenePanels();

    const QString countText = QLocale().toString(static_cast<qulonglong>(count));
    QString summary = QString("%1 splats").arg(countText);
    if (originalCount > count) {
        summary += QString(", trimmed %1 of %2")
                       .arg(QLocale().toString(static_cast<qulonglong>(originalCount - count)),
                            QLocale().toString(static_cast<qulonglong>(originalCount)));
    }
    qInfo("Imported %s (%s).", qPrintable(fileName), qPrintable(summary));
    statusBar()->showMessage(QString("Imported %1 (%2)").arg(fileName, summary), kStatusMessageMs);
}

void MainWindow::showTrimDialog() {
    auto* dialog = new TrimDialog(m_trimSettings, [this](const TrimData& d) { applyDefaultTrim(d); }, this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->show();
}

void MainWindow::applyDefaultTrim(const TrimData& trim) {
    m_trimSettings = trim;
    m_inspector->setDefaultTrim(trim);
    statusBar()->showMessage("Default trim settings saved. They apply to new imports.", kStatusMessageMs);
}

void MainWindow::applyModelTrim(const TrimData& settings) {
    SplatRenderer* renderer = m_viewport->renderer();
    SplatModel* model = renderer ? renderer->GetModel(renderer->GetSelectedModel()) : nullptr;
    if (!model) {
        return;
    }

    // Always trim from the untrimmed data so loosening the values brings detail back.
    model->KeepOriginal();
    const std::vector<SplatVertex>& source = model->SourceSplats();
    std::vector<SplatVertex> trimmed = TrimSplats(source, settings);
    if (trimmed.empty()) {
        QMessageBox::warning(this, "Trim Settings",
                             "These values would remove every splat, so the model was left unchanged.");
        return;
    }

    const size_t total = source.size();
    const size_t kept = trimmed.size();
    renderer->UpdateModel(model, trimmed);
    model->SetTrimData(settings, kept < total);
    refreshScenePanels();
    m_inspector->refreshTrim();

    const QString message = QString("Trimmed %1: kept %2 of %3 splats")
                                .arg(QString::fromStdString(model->GetName()),
                                     QLocale().toString(static_cast<qulonglong>(kept)),
                                     QLocale().toString(static_cast<qulonglong>(total)));
    qInfo("%s.", qPrintable(message));
    statusBar()->showMessage(message, kStatusMessageMs);
}

void MainWindow::untrimModel() {
    SplatRenderer* renderer = m_viewport->renderer();
    SplatModel* model = renderer ? renderer->GetModel(renderer->GetSelectedModel()) : nullptr;
    if (!model || !model->IsTrimmed()) {
        return;
    }

    // The untrimmed data is kept on the model, so Apply can trim it again later.
    const size_t total = model->SourceSplats().size();
    renderer->UpdateModel(model, model->SourceSplats());
    model->SetTrimData(model->GetTrimData(), false);
    refreshScenePanels();
    m_inspector->refreshTrim();

    const QString message = QString("Restored %1: %2 splats")
                                .arg(QString::fromStdString(model->GetName()),
                                     QLocale().toString(static_cast<qulonglong>(total)));
    qInfo("%s.", qPrintable(message));
    statusBar()->showMessage(message, kStatusMessageMs);
}

void MainWindow::selectModel(int index) {
    SplatRenderer* renderer = m_viewport->renderer();
    if (!renderer) {
        return;
    }
    renderer->SelectModel(index);
    m_inspector->setModel(renderer->GetModel(renderer->GetSelectedModel()));

    const bool hasSelection = renderer->GetSelectedModel() >= 0;
    m_renameAction->setEnabled(hasSelection);
    m_deleteAction->setEnabled(hasSelection);
    m_toggleVisibilityAction->setEnabled(hasSelection);
    m_resetPositionAction->setEnabled(hasSelection);
    m_deselectAction->setEnabled(hasSelection);
}

void MainWindow::renameModel(int index, const QString& name) {
    SplatRenderer* renderer = m_viewport->renderer();
    SplatModel* model = renderer ? renderer->GetModel(index) : nullptr;
    if (model && !name.isEmpty()) {
        model->SetName(name.toStdString());
    }
    // Deferred: this can be reached from the outliner's own edit commit,
    // and rebuilding the tree in the middle of that is unsafe.
    QTimer::singleShot(0, this, [this] { refreshScenePanels(); });
}

void MainWindow::toggleModelHidden(int index) {
    SplatRenderer* renderer = m_viewport->renderer();
    SplatModel* model = renderer ? renderer->GetModel(index) : nullptr;
    if (!model) {
        return;
    }
    renderer->SetModelHidden(index, !model->GetIsHidden());
    // Deferred: this can be reached from the outliner's context menu, and
    // rebuilding the tree in the middle of that is unsafe.
    QTimer::singleShot(0, this, [this] { refreshScenePanels(); });

    statusBar()->showMessage(QString("%1 %2").arg(QString::fromStdString(model->GetName()),
                                                  model->GetIsHidden() ? "hidden" : "shown"),
                             kStatusMessageMs);
}

void MainWindow::deleteSelectedModel() {
    SplatRenderer* renderer = m_viewport->renderer();
    if (!renderer || renderer->GetSelectedModel() < 0) {
        return;
    }
    const int index = renderer->GetSelectedModel();
    const QString name = QString::fromStdString(renderer->GetModelName(index));

    m_inspector->setModel(nullptr); // drop the pointer before the model is freed
    m_undo.clear(); // commands hold model pointers; deleting is not undoable yet
    renderer->RemoveModel(index);
    refreshScenePanels();

    qInfo("Removed %s from the scene.", qPrintable(name));
    statusBar()->showMessage(QString("Removed %1 from the scene").arg(name), kStatusMessageMs);
}

void MainWindow::setRenderMode(int mode) {
    const auto renderMode = static_cast<SplatRenderer::RenderMode>(mode);
    (renderMode == SplatRenderer::RenderMode::GaussianSplat ? m_gaussianAction : m_pointCloudAction)
        ->setChecked(true);
    m_modeLabel->setText(RenderModeName(renderMode));
    if (SplatRenderer* renderer = m_viewport->renderer()) {
        renderer->SetRenderMode(renderMode);
    }
}

void MainWindow::exportModels() {
    SplatRenderer* renderer = m_viewport->renderer();
    if (!renderer || renderer->ModelCount() == 0 || m_exportThread) {
        return;
    }

    const int selected = renderer->GetSelectedModel();
    const QString selectedName = selected >= 0 ? QString::fromStdString(renderer->GetModelName(selected)) : QString();
    ExportDialog dialog(selectedName, selected >= 0 ? renderer->GetSplatCount(selected) : 0,
                        renderer->TotalSplatCount(), this);
    if (dialog.exec() != QDialog::Accepted) {
        return;
    }
    const ExportOptions options = dialog.options();
    const bool wholeScene = dialog.wholeScene();

    // Suggest "<model name>.<ext>" (or "scene.<ext>") in the last export folder.
    const QString extension = ExportFormatExtension(options.format);
    QString baseName = wholeScene ? QStringLiteral("scene") : QFileInfo(selectedName).completeBaseName();
    if (baseName.isEmpty()) baseName = QStringLiteral("model");
    QSettings settings;
    const QString folder = settings.value(kExportFolderKey, m_assets->folder()).toString();
    QString path = QFileDialog::getSaveFileName(
        this, "Export", QDir(folder).filePath(baseName + extension),
        QString("%1 (*%2)").arg(ExportFormatName(options.format), extension));
    if (path.isEmpty()) {
        return;
    }
    if (!path.endsWith(extension, Qt::CaseInsensitive)) {
        path += extension;
    }
    settings.setValue(kExportFolderKey, QFileInfo(path).absolutePath());

    // Snapshot the splats: the user can delete or move models while the export runs.
    auto splatData = std::make_shared<std::vector<std::vector<SplatVertex>>>();
    auto transforms = std::make_shared<std::vector<glm::mat4>>();
    for (int i = 0; i < static_cast<int>(renderer->ModelCount()); ++i) {
        if (!wholeScene && i != selected) continue;
        const SplatModel* model = renderer->GetModel(i);
        splatData->push_back(model->splats());
        transforms->push_back(model->GetTransform());
    }

    const QString fileName = QFileInfo(path).fileName();
    qInfo("Exporting %s...", qPrintable(QDir::toNativeSeparators(path)));
    m_exportAction->setEnabled(false);
    statusBar()->showMessage(QString("Exporting %1...").arg(fileName));

    auto result = std::make_shared<ExportResult>();
    const std::filesystem::path nativePath = path.toStdWString();
    m_exportThread = QThread::create([splatData, transforms, result, nativePath, options] {
        std::vector<ExportSource> sources;
        for (size_t i = 0; i < splatData->size(); ++i) {
            sources.push_back({ &(*splatData)[i], (*transforms)[i] });
        }
        *result = ExportSplats(sources, nativePath, options);
    });
    connect(m_exportThread, &QThread::finished, this, [this, result, path, fileName] {
        m_exportThread->deleteLater();
        m_exportThread = nullptr;
        refreshScenePanels(); // re-enables the export action

        if (!result->ok) {
            qWarning("Export of %s failed: %s", qPrintable(fileName), result->error.c_str());
            statusBar()->showMessage(QString("Export of %1 failed").arg(fileName), kStatusMessageMs);
            QMessageBox::warning(this, "Export Failed",
                                 QString("%1 could not be exported.\n\n%2")
                                     .arg(fileName, QString::fromStdString(result->error)));
            return;
        }

        const QLocale locale;
        QString summary = QString("%1 splats").arg(locale.toString(static_cast<qulonglong>(result->splatCount)));
        if (result->triangleCount > 0) {
            summary += QString(", %1 triangles").arg(locale.toString(static_cast<qulonglong>(result->triangleCount)));
        }
        summary += QString(", %1").arg(locale.formattedDataSize(QFileInfo(path).size()));
        qInfo("Exported %s (%s).", qPrintable(QDir::toNativeSeparators(path)), qPrintable(summary));
        statusBar()->showMessage(QString("Exported %1 (%2)").arg(fileName, summary), kStatusMessageMs);
    });
    m_exportThread->start();
}

void MainWindow::refreshScenePanels() {
    SplatRenderer* renderer = m_viewport->renderer();
    if (!renderer) {
        return;
    }
    m_outliner->rebuild(*renderer);
    selectModel(renderer->GetSelectedModel());
    m_exportAction->setEnabled(renderer->ModelCount() > 0 && !m_exportThread);
}

void MainWindow::setImportBusy(const QString& fileName) {
    const bool busy = !fileName.isEmpty();
    m_loadingLabel->setText(busy ? QString("Importing %1...").arg(fileName) : QString());
    m_loadingLabel->setVisible(busy);
    m_loadingBar->setVisible(busy);
    setCursor(busy ? Qt::BusyCursor : Qt::ArrowCursor);
}

// ===========================================================================
// Recent files
// ===========================================================================

void MainWindow::addRecentFile(const QString& path) {
    const QString absolute = QFileInfo(path).absoluteFilePath();
    m_recentFiles.removeAll(absolute);
    m_recentFiles.prepend(absolute);
    while (m_recentFiles.size() > kMaxRecentFiles) {
        m_recentFiles.removeLast();
    }
    rebuildRecentMenu();
}

void MainWindow::rebuildRecentMenu() {
    m_recentMenu->clear();
    for (int i = 0; i < m_recentFiles.size(); ++i) {
        const QString path = m_recentFiles[i];
        QAction* action = m_recentMenu->addAction(
            QString("&%1  %2").arg(i + 1).arg(QFileInfo(path).fileName()), this, [this, path] { importSplat(path); });
        action->setStatusTip(QDir::toNativeSeparators(path));
    }
    if (m_recentFiles.isEmpty()) {
        m_recentMenu->addAction("(none)")->setEnabled(false);
        return;
    }
    m_recentMenu->addSeparator();
    m_recentMenu->addAction("Clear Recent", this, [this] {
        m_recentFiles.clear();
        rebuildRecentMenu();
    });
}

// ===========================================================================
// Account
// ===========================================================================

void MainWindow::showSignIn() {
    if (m_backend->isSignedIn()) {
        return;
    }
    LoginDialog dialog(m_backend, this);
    if (dialog.exec() == QDialog::Accepted) {
        // Bring the user's models into view.
        if (QDockWidget* dock = qobject_cast<QDockWidget*>(m_remoteModels->parentWidget())) {
            dock->show();
            dock->raise();
        }
        statusBar()->showMessage(QString("Signed in as %1").arg(m_backend->user().email), kStatusMessageMs);
    }
}

void MainWindow::updateAccountActions() {
    const bool signedIn = m_backend->isSignedIn();
    const RemoteUser& user = m_backend->user();
    m_accountInfoAction->setText(signedIn ? QString("Signed in as %1%2").arg(user.email, user.isAdmin() ? " (admin)" : "")
                                          : QString("Not signed in"));
    m_signInAction->setEnabled(!signedIn);
    m_signOutAction->setEnabled(signedIn);
}

// ===========================================================================
// Help
// ===========================================================================

void MainWindow::showControls() {
    QMessageBox box(this);
    box.setWindowTitle("Controls");
    box.setTextFormat(Qt::RichText);
    box.setText(
        "<table cellspacing='6'>"
        "<tr><td colspan='2'><b>Viewport camera</b></td></tr>"
        "<tr><td>Right mouse drag</td><td>Orbit</td></tr>"
        "<tr><td>Left mouse drag</td><td>Pan</td></tr>"
        "<tr><td>Mouse wheel</td><td>Zoom</td></tr>"
        "<tr><td>Home</td><td>Recenter camera</td></tr>"
        "<tr><td colspan='2'><br><b>Selected model</b> (viewport focused)</td></tr>"
        "<tr><td>W / S, Up / Down</td><td>Nudge along X</td></tr>"
        "<tr><td>A / D, Left / Right</td><td>Nudge along Z</td></tr>"
        "<tr><td>Esc</td><td>Deselect</td></tr>"
        "<tr><td colspan='2'><br><b>Editor</b></td></tr>"
        "<tr><td>Ctrl+O</td><td>Import splat (.ply)</td></tr>"
        "<tr><td>Ctrl+E</td><td>Export to .glb / .obj / .ply / .stl / .splat</td></tr>"
        "<tr><td>F2 / Delete</td><td>Rename / remove selected model</td></tr>"
        "<tr><td>Ctrl+1 / Ctrl+2</td><td>Point Cloud / Gaussian Splat</td></tr>"
        "<tr><td>Drag &amp; drop</td><td>Drop .ply files onto the window to import</td></tr>"
        "<tr><td colspan='2'><br><b>Account</b></td></tr>"
        "<tr><td>Account &gt; Sign In</td><td>Open the models you uploaded through the web app</td></tr>"
        "</table>");
    box.exec();
}

void MainWindow::showAbout() {
    QMessageBox::about(this, "About Genesis Alpha Build",
                       QString("<h3>%1</h3>"
                               "<p>Real-world object scanning to 3D: a viewer and editor for "
                               "Gaussian-splat reconstructions.</p>"
                               "<p>Team CoDefine &mdash; GAM300/350<br>"
                               "Built with Qt %2, OpenGL, Dear ImGui and FMOD.</p>")
                           .arg(kAppTitle, qVersion()));
}
