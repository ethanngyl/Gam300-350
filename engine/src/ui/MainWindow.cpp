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
panels in sync with it; loads .ply files on a worker thread so the UI stays
responsive; and saves/restores the layout and preferences via QSettings.
**************************************************************************/
#include "ui/Viewport.h"
#include "ui/MainWindow.h"

#include "splat/SplatLoader.h"
#include "splat/SplatRenderer.h"
#include "ui/AssetBrowserPanel.h"
#include "ui/AudioPanel.h"
#include "ui/ConsolePanel.h"
#include "ui/InspectorPanel.h"
#include "ui/OutlinerPanel.h"

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
    constexpr int kLayoutVersion = 1;

    const QString kAppTitle = QStringLiteral("Codefine Engine");

    // QSettings keys.
    const QString kGeometryKey = QStringLiteral("window/geometry");
    const QString kLayoutKey = QStringLiteral("window/layout");
    const QString kAssetFolderKey = QStringLiteral("assets/folder");
    const QString kAudioFolderKey = QStringLiteral("audio/folder");
    const QString kRecentFilesKey = QStringLiteral("files/recent");
    const QString kRenderModeKey = QStringLiteral("view/renderMode");
    const QString kStatsOverlayKey = QStringLiteral("view/statsOverlay");

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

    m_viewport = new Viewport(this);
    setCentralWidget(m_viewport);

    createActions();
    createMenus();
    createToolBar();
    createDocks();
    createStatusBar();

    m_defaultLayout = saveState(kLayoutVersion);
    restoreSettings();

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

    m_viewport->setFocus();
}

MainWindow::~MainWindow() {
    // Never destroy a running QThread: wait for an in-flight import to finish.
    if (m_loadThread) {
        m_loadThread->wait();
        delete m_loadThread.data();
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
        model->SetTransform(transform);
    });

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

    m_resetLayoutAction = new QAction("&Reset Layout", this);
    connect(m_resetLayoutAction, &QAction::triggered, this, [this] {
        restoreState(m_defaultLayout, kLayoutVersion);
    });
}

void MainWindow::createMenus() {
    QMenu* fileMenu = menuBar()->addMenu("&File");
    fileMenu->addAction(m_importAction);
    m_recentMenu = fileMenu->addMenu("Open &Recent");
    fileMenu->addSeparator();
    fileMenu->addAction(m_exitAction);

    QMenu* editMenu = menuBar()->addMenu("&Edit");
    editMenu->addAction(m_renameAction);
    editMenu->addAction(m_deleteAction);
    editMenu->addSeparator();
    editMenu->addAction(m_resetPositionAction);
    editMenu->addAction(m_deselectAction);

    QMenu* viewMenu = menuBar()->addMenu("&View");
    QMenu* renderModeMenu = viewMenu->addMenu("Render &Mode");
    renderModeMenu->addAction(m_pointCloudAction);
    renderModeMenu->addAction(m_gaussianAction);
    viewMenu->addSeparator();
    viewMenu->addAction(m_recenterCameraAction);
    viewMenu->addAction(m_statsOverlayAction);

    // Filled in createDocks() once the docks exist.
    m_windowMenu = menuBar()->addMenu("&Window");

    QMenu* helpMenu = menuBar()->addMenu("&Help");
    helpMenu->addAction("&Controls", QKeySequence::HelpContents, this, [this] { showControls(); });
    helpMenu->addSeparator();
    helpMenu->addAction("&About Codefine", this, [this] { showAbout(); });
    helpMenu->addAction("About &Qt", qApp, &QApplication::aboutQt);
}

void MainWindow::createToolBar() {
    m_toolBar = addToolBar("Main Toolbar");
    m_toolBar->setObjectName("MainToolBar");
    m_toolBar->setMovable(false);
    m_toolBar->setToolButtonStyle(Qt::ToolButtonTextBesideIcon);

    m_toolBar->addAction(m_importAction);
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

    QDockWidget* consoleDock = addPanelDock("Console", "ConsoleDock", m_console, Qt::BottomDockWidgetArea);

    m_audio = new AudioPanel(this);
    QDockWidget* audioDock = addPanelDock("Audio", "AudioDock", m_audio, Qt::BottomDockWidgetArea);

    tabifyDockWidget(assetsDock, consoleDock);
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
    connect(m_outliner, &OutlinerPanel::selectionChanged, this, &MainWindow::selectModel);
    connect(m_outliner, &OutlinerPanel::renameRequested, this, &MainWindow::renameModel);
    connect(m_outliner, &OutlinerPanel::deleteRequested, this, [this](int index) {
        selectModel(index);
        deleteSelectedModel();
    });
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
    m_loadThread = QThread::create([splats, nativePath] { *splats = LoadSplatPly(nativePath); });
    connect(m_loadThread, &QThread::finished, this, [this, splats, path] {
        m_loadThread->deleteLater();
        m_loadThread = nullptr;
        finishImport(path, *splats);
        startNextImport();
    });
    m_loadThread->start();
}

void MainWindow::finishImport(const QString& path, std::vector<SplatVertex>& splats) {
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
    renderer->SetSplats(splats, fileName.toStdString());
    addRecentFile(path);

    selectModel(static_cast<int>(renderer->ModelCount()) - 1);
    refreshScenePanels();

    const QString countText = QLocale().toString(static_cast<qulonglong>(count));
    qInfo("Imported %s (%s splats).", qPrintable(fileName), qPrintable(countText));
    statusBar()->showMessage(QString("Imported %1 (%2 splats)").arg(fileName, countText), kStatusMessageMs);
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

void MainWindow::deleteSelectedModel() {
    SplatRenderer* renderer = m_viewport->renderer();
    if (!renderer || renderer->GetSelectedModel() < 0) {
        return;
    }
    const int index = renderer->GetSelectedModel();
    const QString name = QString::fromStdString(renderer->GetModelName(index));

    m_inspector->setModel(nullptr); // drop the pointer before the model is freed
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

void MainWindow::refreshScenePanels() {
    SplatRenderer* renderer = m_viewport->renderer();
    if (!renderer) {
        return;
    }
    m_outliner->rebuild(*renderer);
    selectModel(renderer->GetSelectedModel());
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
        "<tr><td>F2 / Delete</td><td>Rename / remove selected model</td></tr>"
        "<tr><td>Ctrl+1 / Ctrl+2</td><td>Point Cloud / Gaussian Splat</td></tr>"
        "<tr><td>Drag &amp; drop</td><td>Drop .ply files onto the window to import</td></tr>"
        "</table>");
    box.exec();
}

void MainWindow::showAbout() {
    QMessageBox::about(this, "About Codefine",
                       QString("<h3>%1</h3>"
                               "<p>Real-world object scanning to 3D: a viewer and editor for "
                               "Gaussian-splat reconstructions.</p>"
                               "<p>Team CoDefine &mdash; GAM300/350<br>"
                               "Built with Qt %2, OpenGL, Dear ImGui and FMOD.</p>")
                           .arg(kAppTitle, qVersion()));
}
