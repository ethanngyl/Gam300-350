/*!************************************************************************
\file AudioPanel.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 02-10-2026
\brief
Implements AudioPanel: the folder list and play/stop controls for the FMOD
AudioManager, and the timer that pumps FMOD and refreshes the voice count.
**************************************************************************/
#include "ui/AudioPanel.h"

#include "Manager/AudioManager.h"

#include <QDir>
#include <QFileDialog>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QLabel>
#include <QListWidget>
#include <QPushButton>
#include <QStringList>
#include <QTimer>
#include <QVBoxLayout>

namespace {
    // How often FMOD is pumped. 50ms (~20Hz) is ample for servicing playback.
    constexpr int kAudioUpdateMs = 50;

    // Extensions the folder list shows and the file dialog filters on.
    const QStringList kAudioNameFilters = {
        "*.wav", "*.ogg", "*.mp3", "*.flac", "*.aiff", "*.aif", "*.wma", "*.m4a"
    };

    // Folder opened first: the engine's own assets/audio, baked in at build
    // time so the panel lists the project's audio by default.
#ifdef ENGINE_ASSETS_DIR
    const QString kDefaultAudioDir = QStringLiteral(ENGINE_ASSETS_DIR "/audio");
#else
    const QString kDefaultAudioDir;
#endif

    // Role under which each list item stashes its absolute file path.
    constexpr int kPathRole = Qt::UserRole;
}

AudioPanel::AudioPanel(QWidget* parent)
    : QWidget(parent)
    , m_audio(std::make_unique<AudioManager>()) {
    auto* layout = new QVBoxLayout(this);
    layout->setContentsMargins(4, 4, 4, 4);

    auto* topRow = new QHBoxLayout();
    auto* chooseFolderButton = new QPushButton("Choose Folder...", this);
    m_folderLabel = new QLabel(this);
    m_folderLabel->setObjectName("PanelHint");
    m_folderLabel->setTextInteractionFlags(Qt::TextSelectableByMouse);
    topRow->addWidget(chooseFolderButton);
    topRow->addWidget(m_folderLabel, 1);
    layout->addLayout(topRow);

    m_list = new QListWidget(this);
    // Multi-select so several files can be launched together.
    m_list->setSelectionMode(QAbstractItemView::ExtendedSelection);
    m_list->setAlternatingRowColors(true);
    layout->addWidget(m_list, /*stretch*/ 1);

    auto* buttonRow = new QHBoxLayout();
    auto* playSelectedButton = new QPushButton("Play Selected", this);
    auto* playFileButton = new QPushButton("Play File...", this);
    auto* stopButton = new QPushButton("Stop All", this);
    m_voicesLabel = new QLabel("Playing: 0", this);
    m_voicesLabel->setObjectName("PanelHint");
    buttonRow->addWidget(playSelectedButton);
    buttonRow->addWidget(playFileButton);
    buttonRow->addWidget(stopButton);
    buttonRow->addStretch();
    buttonRow->addWidget(m_voicesLabel);
    layout->addLayout(buttonRow);

    m_statusLabel = new QLabel(this);
    m_statusLabel->setObjectName("PanelHint");
    m_statusLabel->setWordWrap(true);
    layout->addWidget(m_statusLabel);

    // If FMOD failed to start, show why and leave the controls disabled.
    if (!m_audio->IsValid()) {
        m_statusLabel->setText(QString("Audio unavailable: %1")
                                   .arg(QString::fromStdString(m_audio->LastError())));
        qWarning("Audio unavailable: %s", m_audio->LastError().c_str());
        for (QWidget* w : std::initializer_list<QWidget*>{ chooseFolderButton, m_list, playSelectedButton,
                                                           playFileButton, stopButton }) {
            w->setEnabled(false);
        }
        return;
    }

    m_statusLabel->setText("Ready. Double-click a file to play it.");
    setFolder(kDefaultAudioDir);

    connect(chooseFolderButton, &QPushButton::clicked, this, [this] {
        const QString dir = QFileDialog::getExistingDirectory(
            this, "Choose a folder of audio files",
            m_folder.isEmpty() ? kDefaultAudioDir : m_folder);
        if (!dir.isEmpty()) {
            setFolder(dir);
        }
    });

    connect(playSelectedButton, &QPushButton::clicked, this, [this] { playSelected(); });
    // Double-clicking a single row plays just that file.
    connect(m_list, &QListWidget::itemDoubleClicked, this, [this](QListWidgetItem* item) {
        playPath(item->data(kPathRole).toString(), item->text());
    });

    connect(playFileButton, &QPushButton::clicked, this, [this] {
        const QString path = QFileDialog::getOpenFileName(
            this, "Select an audio file",
            m_folder.isEmpty() ? kDefaultAudioDir : m_folder,
            QString("Audio files (%1);;All files (*.*)").arg(kAudioNameFilters.join(' ')));
        if (!path.isEmpty()) {
            playPath(path, QFileInfo(path).fileName());
        }
    });

    connect(stopButton, &QPushButton::clicked, this, [this] { stopAll(); });

    // Pump FMOD regularly so playback progresses, finished sounds are freed and
    // the live voice count stays current.
    auto* audioTimer = new QTimer(this);
    audioTimer->setInterval(kAudioUpdateMs);
    connect(audioTimer, &QTimer::timeout, this, [this] {
        m_audio->Update();
        m_voicesLabel->setText(
            QString("Playing: %1").arg(static_cast<qulonglong>(m_audio->PlayingCount())));
    });
    audioTimer->start();
}

// Out-of-line so unique_ptr<AudioManager> sees the complete type here.
AudioPanel::~AudioPanel() = default;

void AudioPanel::setFolder(const QString& requestedDir) {
    const QString dir = requestedDir.isEmpty() || !QDir(requestedDir).exists()
                            ? kDefaultAudioDir : requestedDir;
    m_folder = dir;
    m_list->clear();

    if (dir.isEmpty()) {
        m_folderLabel->setText("(no folder - built without ENGINE_ASSETS_DIR)");
        return;
    }

    QDir folder(dir);
    const QFileInfoList files =
        folder.entryInfoList(kAudioNameFilters, QDir::Files, QDir::Name);

    m_folderLabel->setText(QString("%1  (%2 file%3)")
                               .arg(QDir::toNativeSeparators(dir))
                               .arg(files.size())
                               .arg(files.size() == 1 ? "" : "s"));
    m_folderLabel->setToolTip(QDir::toNativeSeparators(dir));

    for (const QFileInfo& info : files) {
        auto* item = new QListWidgetItem(info.fileName(), m_list);
        item->setData(kPathRole, info.absoluteFilePath());
    }
}

void AudioPanel::stopAll() {
    if (!m_audio->IsValid()) {
        return;
    }
    m_audio->StopAll();
    m_statusLabel->setText("Stopped all.");
}

void AudioPanel::playPath(const QString& path, const QString& displayName) {
    if (m_audio->Play(path.toStdString())) {
        m_statusLabel->setText(QString("Playing: %1").arg(displayName));
    } else {
        const QString error = QString::fromStdString(m_audio->LastError());
        m_statusLabel->setText(error);
        qWarning("Audio: %s", qPrintable(error));
    }
}

void AudioPanel::playSelected() {
    const QList<QListWidgetItem*> selected = m_list->selectedItems();
    if (selected.isEmpty()) {
        m_statusLabel->setText("Select one or more files to play.");
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
        m_statusLabel->setText(QString("Started %1 file%2.")
                                   .arg(started)
                                   .arg(started == 1 ? "" : "s"));
    } else {
        m_statusLabel->setText(
            QString("Started %1 of %2. Last error: %3")
                .arg(started).arg(selected.size()).arg(lastError));
        qWarning("Audio: %s", qPrintable(lastError));
    }
}
