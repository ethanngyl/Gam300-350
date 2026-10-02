/*!************************************************************************
\file MainWindow.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 01-10-2026
\brief
Implements MainWindow: builds the editor window, wires the central Viewport
to a Qt dock panel (stats label and ImGui "Engine Stats" toggle), adds an
"Audio" dock panel that lists the audio files in a chosen folder and plays
them (multiple at once) through FMOD, and refreshes the FPS / splat-count
readout from the viewport's per-frame stats callback.
**************************************************************************/
#include "ui/Viewport.h"
#include "ui/MainWindow.h"

#include "Manager/AudioManager.h"

#include <QCheckBox>
#include <QDir>
#include <QDockWidget>
#include <QFileDialog>
#include <QFileInfo>
#include <QLabel>
#include <QListWidget>
#include <QPushButton>
#include <QStringList>
#include <QTimer>
#include <QVBoxLayout>

namespace {
    // Stats label refresh interval, so the FPS readout is legible.
    constexpr qint64 kStatsRefreshMs = 250;

    // How often FMOD is pumped. 50ms (~20Hz) is ample for servicing playback.
    constexpr int kAudioUpdateMs = 50;

    // Extensions the folder list shows and the file dialog filters on.
    const QStringList kAudioNameFilters = {
        "*.wav", "*.ogg", "*.mp3", "*.flac", "*.aiff", "*.aif", "*.wma", "*.m4a"
    };

    // Folder opened first in the Audio panel: the engine's own assets/audio,
    // baked in at build time so the panel lists the project's audio by default.
#ifdef ENGINE_ASSETS_DIR
    const QString kDefaultAudioDir = QStringLiteral(ENGINE_ASSETS_DIR "/audio");
#else
    const QString kDefaultAudioDir;
#endif

    // Role under which each list item stashes its absolute file path.
    constexpr int kPathRole = Qt::UserRole;
}

MainWindow::MainWindow()
    : m_audio(std::make_unique<AudioManager>()) {
    setWindowTitle("Codefine - Engine Foundation (M1)");
    resize(1280, 720);

    m_viewport = new Viewport(this);
    setCentralWidget(m_viewport);

    // Qt dock panel, showing Qt widgets and the ImGui overlay driving each other.
    auto* panel = new QWidget(this);
    auto* layout = new QVBoxLayout(panel);
    m_statsLabel = new QLabel("Waiting for first frame...", panel);
    auto* imguiStatsToggle = new QCheckBox("Show ImGui \"Engine Stats\" window", panel);
    imguiStatsToggle->setChecked(true);
    layout->addWidget(m_statsLabel);
    layout->addWidget(imguiStatsToggle);
    layout->addStretch();

    auto* dock = new QDockWidget("Engine (Qt)", this);
    dock->setWidget(panel);
    addDockWidget(Qt::RightDockWidgetArea, dock);

    connect(imguiStatsToggle, &QCheckBox::toggled, this, [this](bool checked) {
        m_viewport->setShowImGuiStats(checked);
    });

    buildAudioPanel();

    m_statsTimer.start();
    m_viewport->onStats = [this](float fps, std::size_t splatCount) {
        if (m_statsTimer.elapsed() < kStatsRefreshMs) {
            return;
        }
        m_statsTimer.restart();
        m_statsLabel->setText(QString("FPS: %1\nSplats loaded: %2")
                                  .arg(fps, 0, 'f', 1)
                                  .arg(static_cast<qulonglong>(splatCount)));
    };

    m_viewport->setFocus();
}

// Out-of-line so unique_ptr<AudioManager> sees the complete type here.
MainWindow::~MainWindow() = default;

void MainWindow::buildAudioPanel() {
    auto* panel = new QWidget(this);
    auto* layout = new QVBoxLayout(panel);

    auto* chooseFolderButton = new QPushButton("Choose Folder...", panel);
    m_audioFolderLabel = new QLabel(panel);
    m_audioFolderLabel->setWordWrap(true);

    m_audioList = new QListWidget(panel);
    // Multi-select so several files can be launched together.
    m_audioList->setSelectionMode(QAbstractItemView::ExtendedSelection);

    auto* playSelectedButton = new QPushButton("Play Selected", panel);
    auto* playFileButton = new QPushButton("Play File Not Listed...", panel);
    auto* stopButton = new QPushButton("Stop All", panel);

    m_voicesLabel = new QLabel("Audio playing: 0", panel);
    m_audioStatusLabel = new QLabel(panel);
    m_audioStatusLabel->setWordWrap(true);

    layout->addWidget(chooseFolderButton);
    layout->addWidget(m_audioFolderLabel);
    layout->addWidget(m_audioList, /*stretch*/ 1);
    layout->addWidget(playSelectedButton);
    layout->addWidget(playFileButton);
    layout->addWidget(stopButton);
    layout->addWidget(m_voicesLabel);
    layout->addWidget(m_audioStatusLabel);

    auto* dock = new QDockWidget("Audio", this);
    dock->setWidget(panel);
    addDockWidget(Qt::RightDockWidgetArea, dock);

    // If FMOD failed to start, show why and leave the controls disabled.
    if (!m_audio->IsValid()) {
        m_audioStatusLabel->setText(QString("Audio unavailable: %1")
                                        .arg(QString::fromStdString(m_audio->LastError())));
        chooseFolderButton->setEnabled(false);
        m_audioList->setEnabled(false);
        playSelectedButton->setEnabled(false);
        playFileButton->setEnabled(false);
        stopButton->setEnabled(false);
        return;
    }

    m_audioStatusLabel->setText("Ready.");
    populateAudioList(kDefaultAudioDir);

    connect(chooseFolderButton, &QPushButton::clicked, this, [this] {
        const QString dir = QFileDialog::getExistingDirectory(
            this, "Choose a folder of audio files",
            m_audioFolder.isEmpty() ? kDefaultAudioDir : m_audioFolder);
        if (!dir.isEmpty()) {
            populateAudioList(dir);
        }
    });

    connect(playSelectedButton, &QPushButton::clicked, this, [this] { playSelectedAudio(); });
    // Double-clicking a single row plays just that file.
    connect(m_audioList, &QListWidget::itemDoubleClicked, this, [this](QListWidgetItem* item) {
        const QString path = item->data(kPathRole).toString();
        if (m_audio->Play(path.toStdString())) {
            m_audioStatusLabel->setText(QString("Playing: %1").arg(item->text()));
        } else {
            m_audioStatusLabel->setText(QString::fromStdString(m_audio->LastError()));
        }
    });

    connect(playFileButton, &QPushButton::clicked, this, [this] {
        const QString path = QFileDialog::getOpenFileName(
            this, "Select an audio file",
            m_audioFolder.isEmpty() ? kDefaultAudioDir : m_audioFolder,
            QString("Audio files (%1);;All files (*.*)").arg(kAudioNameFilters.join(' ')));
        if (path.isEmpty()) {
            return; // user cancelled
        }
        if (m_audio->Play(path.toStdString())) {
            m_audioStatusLabel->setText(QString("Playing: %1").arg(QFileInfo(path).fileName()));
        } else {
            m_audioStatusLabel->setText(QString::fromStdString(m_audio->LastError()));
        }
    });

    connect(stopButton, &QPushButton::clicked, this, [this] {
        m_audio->StopAll();
        m_audioStatusLabel->setText("Stopped all.");
    });

    // Pump FMOD regularly so playback progresses, finished sounds are freed and
    // the live voice count stays current.
    auto* audioTimer = new QTimer(this);
    audioTimer->setInterval(kAudioUpdateMs);
    connect(audioTimer, &QTimer::timeout, this, [this] {
        m_audio->Update();
        m_voicesLabel->setText(
            QString("Audio playing: %1").arg(static_cast<qulonglong>(m_audio->PlayingCount())));
    });
    audioTimer->start();
}

void MainWindow::populateAudioList(const QString& dir) {
    m_audioFolder = dir;
    m_audioList->clear();

    if (dir.isEmpty()) {
        m_audioFolderLabel->setText("Folder: (none — build without ENGINE_ASSETS_DIR)");
        return;
    }

    QDir folder(dir);
    const QFileInfoList files =
        folder.entryInfoList(kAudioNameFilters, QDir::Files, QDir::Name);

    m_audioFolderLabel->setText(QString("Folder: %1  (%2 file%3)")
                                    .arg(QDir::toNativeSeparators(dir))
                                    .arg(files.size())
                                    .arg(files.size() == 1 ? "" : "s"));

    for (const QFileInfo& info : files) {
        auto* item = new QListWidgetItem(info.fileName(), m_audioList);
        item->setData(kPathRole, info.absoluteFilePath());
    }
}

void MainWindow::playSelectedAudio() {
    const QList<QListWidgetItem*> selected = m_audioList->selectedItems();
    if (selected.isEmpty()) {
        m_audioStatusLabel->setText("Select one or more files to play.");
        return;
    }

    int started = 0;
    QString lastError;
    for (QListWidgetItem* item : selected) {
        const QString path = item->data(kPathRole).toString();
        if (m_audio->Play(path.toStdString())) {
            ++started;
        } else {
            lastError = QString::fromStdString(m_audio->LastError());
        }
    }

    if (started == selected.size()) {
        m_audioStatusLabel->setText(QString("Started %1 file%2.")
                                        .arg(started)
                                        .arg(started == 1 ? "" : "s"));
    } else {
        m_audioStatusLabel->setText(
            QString("Started %1 of %2. Last error: %3")
                .arg(started).arg(selected.size()).arg(lastError));
    }
}
