/*!************************************************************************
\file RemoteModelsPanel.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Implements RemoteModelsPanel: the account bar, name filter, job list with
status/date columns and context menu, and the download progress row. Which
jobs appear is decided by the backend, never here: it only returns the
caller's own jobs, or all of them for an admin.
**************************************************************************/
#include "ui/RemoteModelsPanel.h"

#include <QDir>
#include <QFileInfo>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QLabel>
#include <QLineEdit>
#include <QLocale>
#include <QMenu>
#include <QMessageBox>
#include <QProgressBar>
#include <QPushButton>
#include <QStyle>
#include <QTimer>
#include <QTreeWidget>
#include <QVBoxLayout>

#include <algorithm>

namespace {
    enum Column { kNameColumn = 0, kStatusColumn = 1, kCreatedColumn = 2 };

    // Role under which each row stashes its job id.
    constexpr int kIdRole = Qt::UserRole;
    // Role holding the creation time in ms, so the Created column sorts by time.
    constexpr int kTimeRole = Qt::UserRole + 1;

    // Row type whose Created column sorts by time rather than by display text.
    class JobItem : public QTreeWidgetItem {
    public:
        using QTreeWidgetItem::QTreeWidgetItem;
        bool operator<(const QTreeWidgetItem& other) const override {
            const int column = treeWidget() ? treeWidget()->sortColumn() : kNameColumn;
            if (column == kCreatedColumn) {
                return data(kCreatedColumn, kTimeRole).toLongLong() < other.data(kCreatedColumn, kTimeRole).toLongLong();
            }
            return QTreeWidgetItem::operator<(other);
        }
    };

    QString StatusText(const RemoteJob& job) {
        if (job.status == "done") return job.hasResult ? "Ready" : "No model";
        if (job.status == "running") return QString("Processing %1%").arg(qRound(job.progress * 100));
        if (job.status == "queued") return "Queued";
        if (job.status == "error") return "Failed";
        if (job.status == "cancelled") return "Cancelled";
        return job.status;
    }

    // A job name made safe to use as a file name on any OS.
    QString SafeFileName(const QString& name) {
        QString safe;
        for (const QChar c : name) {
            safe += (c < QChar(32) || QStringLiteral("<>:\"/\\|?*").contains(c)) ? QChar('_') : c;
        }
        safe = safe.trimmed();
        while (safe.endsWith('.')) {
            safe.chop(1); // Windows drops trailing dots
        }
        return safe.left(80);
    }

    // How often a build in progress is polled (the web app's Processing screen polls about as often).
    constexpr int kPollIntervalMs = 2000;

    // The web app's step names (PHASE_LABELS in Processing.jsx).
    QString PhaseLabel(const QString& phase) {
        static const QHash<QString, QString> labels = {
            { "upload", "Preparing upload" },
            { "extract", "Extracting frames" },
            { "masking", "Removing background" },
            { "colmap-features", "Analyzing photos" },
            { "colmap-matching", "Matching photos" },
            { "colmap-mapping", "Recovering camera positions" },
            { "training", "Training 3D model" },
            { "normalize", "Finalizing model" },
            { "done", "Done" },
        };
        return labels.value(phase, phase.isEmpty() ? QStringLiteral("Starting") : phase);
    }

    // "0:42" or "12:05".
    QString Elapsed(qint64 ms) {
        const qint64 seconds = ms / 1000;
        return QString("%1:%2").arg(seconds / 60).arg(seconds % 60, 2, 10, QChar('0'));
    }
}

RemoteModelsPanel::RemoteModelsPanel(BackendClient* client, QWidget* parent)
    : QWidget(parent)
    , m_client(client) {
    auto* layout = new QVBoxLayout(this);
    layout->setContentsMargins(4, 4, 4, 4);
    layout->setSpacing(4);

    auto* topRow = new QHBoxLayout();
    m_refreshButton = new QPushButton(style()->standardIcon(QStyle::SP_BrowserReload), "", this);
    m_refreshButton->setToolTip("Reload the model list from the server");
    m_accountLabel = new QLabel(this);
    m_accountLabel->setObjectName("PanelHint");
    m_search = new QLineEdit(this);
    m_search->setPlaceholderText("Filter by name...");
    m_search->setClearButtonEnabled(true);
    m_search->setMaximumWidth(220);
    m_accountButton = new QPushButton(this);
    m_importButton = new QPushButton("Import", this);
    m_importButton->setToolTip("Download the selected model and load it into the scene");
    m_generateButton = new QPushButton("Generate...", this);
    m_generateButton->setToolTip("Build a new model from photos or a video on the server, like the web app");

    topRow->addWidget(m_refreshButton);
    topRow->addWidget(m_accountLabel, 1);
    topRow->addWidget(m_search);
    topRow->addWidget(m_accountButton);
    topRow->addWidget(m_generateButton);
    topRow->addWidget(m_importButton);
    layout->addLayout(topRow);

    m_genRow = new QWidget(this);
    auto* genLayout = new QHBoxLayout(m_genRow);
    genLayout->setContentsMargins(0, 0, 0, 0);
    m_genLabel = new QLabel(m_genRow);
    m_genLabel->setWordWrap(true);
    m_genProgress = new QProgressBar(m_genRow);
    m_genProgress->setMaximumHeight(14);
    m_genProgress->setMaximumWidth(220);
    m_genProgress->setRange(0, 1000);
    m_genProgress->setTextVisible(false);
    m_genCancel = new QPushButton("Cancel", m_genRow);
    genLayout->addWidget(m_genLabel, 1);
    genLayout->addWidget(m_genProgress);
    genLayout->addWidget(m_genCancel);
    layout->addWidget(m_genRow);
    m_genRow->hide();

    m_pollTimer = new QTimer(this);
    m_pollTimer->setInterval(kPollIntervalMs);

    m_local = new LocalReconstruction(this);
    connect(m_local, &LocalReconstruction::statusChanged, this, [this](const JobStatus& status) {
        if (!status.isFinished()) showBuildProgress(status);
    });
    connect(m_local, &LocalReconstruction::finished, this, &RemoteModelsPanel::onLocalFinished);

    m_message = new QLabel(this);
    m_message->setObjectName("EmptyState");
    m_message->setWordWrap(true);
    m_message->hide();
    layout->addWidget(m_message);

    m_list = new QTreeWidget(this);
    m_list->setColumnCount(3);
    m_list->setHeaderLabels({ "Name", "Status", "Created" });
    m_list->setRootIsDecorated(false);
    m_list->setAlternatingRowColors(true);
    m_list->setUniformRowHeights(true);
    m_list->setSortingEnabled(true);
    m_list->sortByColumn(kCreatedColumn, Qt::DescendingOrder);
    m_list->setContextMenuPolicy(Qt::CustomContextMenu);
    m_list->header()->setSectionResizeMode(kNameColumn, QHeaderView::Stretch);
    m_list->header()->setSectionResizeMode(kStatusColumn, QHeaderView::ResizeToContents);
    m_list->header()->setSectionResizeMode(kCreatedColumn, QHeaderView::ResizeToContents);
    m_list->header()->setStretchLastSection(false);
    layout->addWidget(m_list, 1);

    auto* progressRow = new QHBoxLayout();
    m_progress = new QProgressBar(this);
    m_progress->setMaximumHeight(14);
    m_cancelButton = new QPushButton("Cancel", this);
    progressRow->addWidget(m_progress, 1);
    progressRow->addWidget(m_cancelButton);
    layout->addLayout(progressRow);
    m_progress->hide();
    m_cancelButton->hide();

    connect(m_refreshButton, &QPushButton::clicked, this, [this] { refresh(); });
    connect(m_search, &QLineEdit::textChanged, this, [this] { applyFilter(); });
    connect(m_importButton, &QPushButton::clicked, this, [this] { openCurrent(); });
    connect(m_list, &QTreeWidget::itemDoubleClicked, this, [this] { openCurrent(); });
    connect(m_list, &QTreeWidget::currentItemChanged, this, [this] { updateButtons(); });
    connect(m_cancelButton, &QPushButton::clicked, m_client, &BackendClient::cancelDownload);
    connect(m_generateButton, &QPushButton::clicked, this, [this] { showGenerateDialog(); });
    connect(m_genCancel, &QPushButton::clicked, this, [this] { cancelGeneration(); });
    connect(m_pollTimer, &QTimer::timeout, this, [this] { pollGeneration(); });

    connect(m_client, &BackendClient::uploadProgress, this, [this](qint64 sent, qint64 total) {
        if (!m_genUploading || total <= 0) return;
        m_genProgress->setRange(0, 1000);
        m_genProgress->setValue(static_cast<int>(sent * 1000 / total));
        m_genLabel->setText(QString("Uploading: %1 of %2").arg(QLocale().formattedDataSize(sent),
                                                               QLocale().formattedDataSize(total)));
    });
    connect(m_client, &BackendClient::generationStarted, this, &RemoteModelsPanel::onGenerationStarted);
    connect(m_client, &BackendClient::generationFailed, this, [this](const QString& error) {
        if (!m_genUploading) return;
        m_genUploading = false;
        qWarning("Couldn't start the model: %s", qPrintable(error));
        endGeneration(QString("Couldn't start the model: %1").arg(error));
    });
    connect(m_client, &BackendClient::jobStatusReceived, this, &RemoteModelsPanel::onJobStatus);
    connect(m_client, &BackendClient::jobStatusFailed, this, [this](const QString& jobId, const QString& error) {
        if (jobId != m_genJobId) return;
        // Keep polling: the build carries on on the server even while it can't be reached.
        m_genLabel->setText(QString("%1: can't reach the server, retrying... (%2)")
                                .arg(m_genName.isEmpty() ? QStringLiteral("New model") : m_genName, error));
    });
    connect(m_accountButton, &QPushButton::clicked, this, [this] {
        if (m_client->isSignedIn()) {
            m_client->signOut();
        } else {
            emit signInRequested();
        }
    });

    connect(m_list, &QTreeWidget::customContextMenuRequested, this, [this](const QPoint& pos) {
        QMenu menu(this);
        if (m_list->itemAt(pos)) {
            QAction* import = menu.addAction("Import into Scene", this, [this] { openCurrent(); });
            import->setEnabled(m_importButton->isEnabled());
            menu.addSeparator();
        }
        menu.addAction("Refresh", this, [this] { refresh(); })->setEnabled(m_client->isSignedIn());
        menu.exec(m_list->viewport()->mapToGlobal(pos));
    });

    connect(m_client, &BackendClient::sessionChanged, this, &RemoteModelsPanel::onSessionChanged);
    connect(m_client, &BackendClient::jobsReceived, this, &RemoteModelsPanel::showJobs);
    connect(m_client, &BackendClient::requestFailed, this, [this](const QString& error) {
        m_message->setText(error);
        m_message->show();
    });
    connect(m_client, &BackendClient::downloadProgress, this, [this](qint64 received, qint64 total) {
        if (total > 0) {
            m_progress->setRange(0, 1000);
            m_progress->setValue(static_cast<int>(received * 1000 / total));
            m_progress->setFormat(QString("%1 of %2").arg(QLocale().formattedDataSize(received),
                                                          QLocale().formattedDataSize(total)));
        } else {
            m_progress->setRange(0, 0); // size unknown
        }
    });
    connect(m_client, &BackendClient::downloadFinished, this,
            [this](const QString& jobId, const QString& path, const QString& error) {
                m_progress->hide();
                m_cancelButton->hide();
                updateButtons();
                if (!error.isEmpty()) {
                    qWarning("Model download failed: %s", qPrintable(error));
                    m_message->setText(error);
                    m_message->show();
                    if (m_followUps.remove(jobId)) {
                        endGeneration(QString("The model was built but couldn't be downloaded: %1. "
                                              "Import it from the list to try again.").arg(error));
                    }
                } else {
                    m_message->hide();
                    deliver(jobId, path);
                }
                // A finished build that was waiting for this download to end.
                if (!m_autoOpenJobId.isEmpty()) m_client->fetchJobs();
            });

    onSessionChanged();
}

void RemoteModelsPanel::refresh() {
    if (m_client->isSignedIn()) {
        m_client->fetchJobs();
    } else if (m_client->hasSavedSession()) {
        m_client->restoreSession(); // e.g. the server was down at startup
    }
}

void RemoteModelsPanel::onSessionChanged() {
    m_jobs.clear();
    m_list->clear();
    m_progress->hide();
    m_cancelButton->hide();
    if (!m_client->isSignedIn() && !m_local->isRunning()) {
        // The upload was aborted with the session; a build already on the server carries on there.
        // A build on this PC needs no account, so signing out leaves it running.
        resetGeneration();
    }

    if (m_client->isSignedIn()) {
        const RemoteUser& user = m_client->user();
        m_accountLabel->setText(QString("%1 (%2)%3")
                                    .arg(user.name, user.email, user.isAdmin() ? "  |  admin: every user's models" : ""));
        m_accountLabel->setToolTip(m_client->serverUrl().toString());
        m_accountButton->setText("Sign Out");
        m_accountButton->setToolTip("Sign out and delete this account's downloaded models from this PC");
        m_message->setText("Loading...");
        m_message->show();
        m_client->fetchJobs();
    } else {
        m_accountLabel->setText("Not signed in");
        m_accountLabel->setToolTip(QString());
        m_accountButton->setText("Sign In...");
        m_accountButton->setToolTip("Sign in with your web app account");
        m_message->setText("Sign in with your web app account to see the models you uploaded.");
        m_message->show();
    }
    updateButtons();
}

void RemoteModelsPanel::showJobs(const QList<RemoteJob>& jobs) {
    const QString previous = m_list->currentItem() ? m_list->currentItem()->data(kNameColumn, kIdRole).toString()
                                                   : QString();
    m_jobs = jobs;
    m_list->setSortingEnabled(false);
    m_list->clear();

    const QLocale locale;
    const QColor dimmed = palette().color(QPalette::Disabled, QPalette::Text);
    for (const RemoteJob& job : m_jobs) {
        auto* item = new JobItem(m_list);
        item->setText(kNameColumn, job.displayName());
        item->setIcon(kNameColumn, style()->standardIcon(QStyle::SP_FileIcon));
        item->setData(kNameColumn, kIdRole, job.id);
        item->setText(kStatusColumn, StatusText(job));
        item->setText(kCreatedColumn, locale.toString(job.createdAt, QLocale::ShortFormat));
        item->setData(kCreatedColumn, kTimeRole, job.createdAt.toMSecsSinceEpoch());

        QString tip = QString("%1\n%2 photo%3").arg(job.displayName()).arg(job.imageCount).arg(job.imageCount == 1 ? "" : "s");
        if (!job.error.isEmpty()) tip += "\n" + job.error;
        item->setToolTip(kNameColumn, tip);
        item->setToolTip(kStatusColumn, tip);
        if (!job.hasResult) {
            for (int column = 0; column < m_list->columnCount(); ++column) {
                item->setForeground(column, dimmed);
            }
        }
        if (job.id == previous) {
            m_list->setCurrentItem(item);
        }
    }
    m_list->setSortingEnabled(true);

    const int ready = static_cast<int>(std::count_if(m_jobs.begin(), m_jobs.end(),
                                                     [](const RemoteJob& job) { return job.hasResult; }));
    if (m_jobs.isEmpty()) {
        m_message->setText("No models yet. Scan an object in the web app and it will show up here.");
        m_message->show();
    } else {
        m_message->hide();
    }
    m_list->headerItem()->setText(kNameColumn, QString("Name  (%1 ready)").arg(ready));

    applyFilter();
    updateButtons();

    // A build just finished: download it now that the list knows its final name.
    if (!m_autoOpenJobId.isEmpty() && !m_client->isDownloading()) {
        for (const RemoteJob& job : m_jobs) {
            if (job.id == m_autoOpenJobId && job.hasResult) {
                m_autoOpenJobId.clear();
                open(job);
                break;
            }
        }
    }
}

void RemoteModelsPanel::applyFilter() {
    const QString needle = m_search->text().trimmed();
    for (int i = 0; i < m_list->topLevelItemCount(); ++i) {
        QTreeWidgetItem* item = m_list->topLevelItem(i);
        item->setHidden(!needle.isEmpty() && !item->text(kNameColumn).contains(needle, Qt::CaseInsensitive));
    }
}

void RemoteModelsPanel::updateButtons() {
    const bool signedIn = m_client->isSignedIn();
    m_refreshButton->setEnabled(signedIn || m_client->hasSavedSession());
    m_search->setEnabled(signedIn);

    bool importable = false;
    if (QTreeWidgetItem* item = m_list->currentItem()) {
        const QString id = item->data(kNameColumn, kIdRole).toString();
        for (const RemoteJob& job : m_jobs) {
            if (job.id == id) importable = job.hasResult;
        }
    }
    m_importButton->setEnabled(signedIn && importable && !m_client->isDownloading());
    m_generateButton->setEnabled(!isGenerating());
}

void RemoteModelsPanel::openCurrent() {
    QTreeWidgetItem* item = m_list->currentItem();
    if (!item) {
        return;
    }
    const QString id = item->data(kNameColumn, kIdRole).toString();
    for (const RemoteJob& job : m_jobs) {
        if (job.id == id) {
            open(job);
            return;
        }
    }
}

void RemoteModelsPanel::open(const RemoteJob& job) {
    if (!job.hasResult || m_client->isDownloading()) {
        return;
    }

    // Reuse the cached copy unless the job changed (re-run, renamed) since.
    const QString path = cachePath(job);
    const QFileInfo cached(path);
    if (cached.isFile() && cached.size() > 0 && cached.lastModified() >= job.updatedAt) {
        deliver(job.id, path);
        return;
    }

    QDir(cached.absolutePath()).removeRecursively(); // a stale copy, maybe under an old name
    qInfo("Downloading %s from %s...", qPrintable(job.displayName()), qPrintable(m_client->serverUrl().toString()));
    m_message->setText(QString("Downloading %1...").arg(job.displayName()));
    m_message->show();
    m_progress->setRange(0, 0);
    m_progress->setFormat(QString());
    m_progress->show();
    m_cancelButton->show();
    m_client->downloadResult(job, path);
    updateButtons();
}

// ===========================================================================
// Generating a model
// ===========================================================================

bool RemoteModelsPanel::isGenerating() const {
    return m_genUploading || !m_genJobId.isEmpty() || !m_autoOpenJobId.isEmpty() || m_local->isRunning();
}

bool RemoteModelsPanel::isBuildingLocally() const {
    return m_local->isRunning();
}

void RemoteModelsPanel::showGenerateDialog() {
    if (isGenerating()) {
        QMessageBox::information(this, "Generate Model",
                                 "A model is already being built. Wait for it to finish or cancel it first.");
        return;
    }
    GenerateModelDialog dialog(m_client->isSignedIn(), m_client->serverUrl().toString(), this);
    if (dialog.exec() != QDialog::Accepted) return;

    if (dialog.buildLocally()) {
        startLocalBuild(dialog.request(), dialog.followUp());
        return;
    }
    if (!m_client->isSignedIn()) {
        emit signInRequested();
        if (!m_client->isSignedIn()) return; // the sign-in dialog was closed without signing in
    }
    startGeneration(dialog.request(), dialog.followUp());
}

void RemoteModelsPanel::startLocalBuild(const GenerationRequest& request, const GenerationFollowUp& followUp) {
    m_genName = request.name;
    m_localFollowUp = followUp;
    m_genClock.start();
    m_genLabel->setText(QString("%1: preparing to build on this PC...")
                            .arg(m_genName.isEmpty() ? QStringLiteral("New model") : m_genName));
    m_genProgress->setRange(0, 0);
    m_genProgress->show();
    m_genCancel->setText("Cancel");
    m_genCancel->show();
    m_genRow->show();
    qInfo("Building a model on this PC from %lld file(s)...", static_cast<long long>(request.files.size()));
    m_local->start(request, followUp.copyFolder);
    updateButtons();
}

void RemoteModelsPanel::onLocalFinished(const QString& path, const QString& error) {
    const QString name = m_genName.isEmpty() ? QStringLiteral("New model") : m_genName;
    const QString elapsed = Elapsed(m_genClock.elapsed());
    if (error == QLatin1String("Cancelled.")) {
        qInfo("Building %s on this PC was cancelled.", qPrintable(name));
        resetGeneration();
        return;
    }
    if (!error.isEmpty()) {
        qWarning("Building %s on this PC failed: %s (log: %s)", qPrintable(name), qPrintable(error),
                 qPrintable(QDir::toNativeSeparators(m_local->logPath())));
        endGeneration(QString("%1 couldn't be built: %2").arg(name, error));
        m_genLabel->setToolTip("Full tool output: " + QDir::toNativeSeparators(m_local->logPath()));
        return;
    }

    qInfo("%s was built on this PC in %s: %s", qPrintable(name), qPrintable(elapsed),
          qPrintable(QDir::toNativeSeparators(path)));
    const GenerationFollowUp followUp = m_localFollowUp;
    resetGeneration();
    // The .ply is already saved in the folder; only an .obj copy is left to make.
    if (followUp.copy == GenerationFollowUp::Copy::ObjPoints || followUp.copy == GenerationFollowUp::Copy::ObjMesh) {
        emit saveCopyRequested(path, followUp);
    }
    if (followUp.importIntoScene) emit importRequested(path);
}

void RemoteModelsPanel::showBuildProgress(const JobStatus& status) {
    const QString name = m_genName.isEmpty() ? QStringLiteral("New model") : m_genName;
    QString text = status.status == "queued"
                       ? QString("%1: waiting for the server (other builds first)").arg(name)
                       : QString("%1: %2").arg(name, PhaseLabel(status.phase));
    if (!status.detail.isEmpty()) text += QString(" (%1)").arg(status.detail);
    m_genLabel->setText(text + QString("  |  %1").arg(Elapsed(m_genClock.elapsed())));
    if (status.status == "queued") {
        m_genProgress->setRange(0, 0);
    } else {
        m_genProgress->setRange(0, 1000);
        m_genProgress->setValue(qBound(0, qRound(status.progress * 1000.0), 1000));
    }
}

void RemoteModelsPanel::startGeneration(const GenerationRequest& request, const GenerationFollowUp& followUp) {
    m_genUploading = true;
    m_genName = request.name;
    m_pendingFollowUp = followUp;
    const int count = static_cast<int>(request.files.size());
    m_genLabel->setText(QString("Uploading %1 %2...")
                            .arg(count)
                            .arg(request.source == GenerationRequest::Source::Media ? (count == 1 ? "video" : "videos")
                                                                                    : "photos"));
    m_genProgress->setRange(0, 0);
    m_genProgress->show();
    m_genCancel->setText("Cancel");
    m_genRow->show();
    updateButtons();
    m_client->startGeneration(request);
}

void RemoteModelsPanel::onGenerationStarted(const QString& jobId) {
    if (!m_genUploading) return;
    m_genUploading = false;
    m_genJobId = jobId;
    m_followUps.insert(jobId, m_pendingFollowUp);
    m_genClock.start();
    m_genLabel->setText(QString("%1: queued on the server...").arg(m_genName.isEmpty() ? QStringLiteral("New model") : m_genName));
    m_genProgress->setRange(0, 0);
    m_client->fetchJobs(); // show it in the list straight away
    pollGeneration();
    m_pollTimer->start();
    updateButtons();
}

void RemoteModelsPanel::pollGeneration() {
    if (!m_genJobId.isEmpty()) m_client->fetchJobStatus(m_genJobId);
}

void RemoteModelsPanel::onJobStatus(const JobStatus& status) {
    if (status.id != m_genJobId) return;
    const QString name = m_genName.isEmpty() ? QStringLiteral("New model") : m_genName;
    const QString elapsed = Elapsed(m_genClock.elapsed());

    if (!status.isFinished()) {
        showBuildProgress(status);
        return;
    }

    const QString jobId = m_genJobId;
    m_pollTimer->stop();
    m_genJobId.clear();
    m_client->fetchJobs(); // the list shows the final status

    if (status.status == "done" && status.hasResult) {
        qInfo("%s was built in %s. Downloading it...", qPrintable(name), qPrintable(elapsed));
        m_genLabel->setText(QString("%1: built in %2, downloading...").arg(name, elapsed));
        m_genProgress->setRange(0, 0);
        m_genCancel->hide(); // the download has its own Cancel
        m_autoOpenJobId = jobId; // opened by showJobs once the list arrives
        updateButtons();
        return;
    }

    m_followUps.remove(jobId);
    if (status.status == "cancelled") {
        qInfo("%s was cancelled.", qPrintable(name));
        resetGeneration();
        return;
    }
    const QString reason = !status.error.isEmpty() ? status.error : QStringLiteral("it finished without a model");
    qWarning("Building %s failed: %s", qPrintable(name), qPrintable(reason));
    endGeneration(QString("%1 couldn't be built: %2").arg(name, reason));
}

void RemoteModelsPanel::cancelGeneration() {
    if (m_genUploading) {
        m_genUploading = false; // so the generationFailed that follows is ignored
        m_client->cancelUpload();
        qInfo("Upload cancelled.");
        resetGeneration();
        return;
    }
    if (m_local->isRunning()) {
        const auto answer = QMessageBox::question(
            this, "Cancel Build", "Stop building this model on this PC? Nothing is kept.",
            QMessageBox::Yes | QMessageBox::No, QMessageBox::No);
        if (answer == QMessageBox::Yes) m_local->cancel(); // finished("Cancelled.") resets the row
        return;
    }
    if (m_genJobId.isEmpty()) {
        resetGeneration(); // "Dismiss" on a finished / failed build
        return;
    }
    const QString name = m_genName.isEmpty() ? QStringLiteral("this model") : m_genName;
    const auto answer = QMessageBox::question(
        this, "Cancel Build",
        QString("Stop building %1? The server stops working on it and the photos are kept, but no model is made.").arg(name),
        QMessageBox::Yes | QMessageBox::No, QMessageBox::No);
    if (answer != QMessageBox::Yes || m_genJobId.isEmpty()) return;
    m_client->cancelJob(m_genJobId);
    m_followUps.remove(m_genJobId);
    resetGeneration();
    QTimer::singleShot(1000, this, [this] { refresh(); }); // let the server record the cancel first
}

void RemoteModelsPanel::endGeneration(const QString& message) {
    m_pollTimer->stop();
    m_genUploading = false;
    m_genJobId.clear();
    m_autoOpenJobId.clear();
    m_genLabel->setText(message);
    m_genProgress->hide();
    m_genCancel->setText("Dismiss");
    m_genCancel->show();
    m_genRow->show();
    updateButtons();
}

void RemoteModelsPanel::resetGeneration() {
    m_pollTimer->stop();
    m_genUploading = false;
    m_genJobId.clear();
    m_autoOpenJobId.clear();
    m_genName.clear();
    m_genRow->hide();
    m_genLabel->setToolTip(QString());
    m_genCancel->setText("Cancel");
    m_genCancel->show();
    updateButtons();
}

void RemoteModelsPanel::deliver(const QString& jobId, const QString& path) {
    const auto it = m_followUps.constFind(jobId);
    if (it == m_followUps.constEnd()) {
        emit importRequested(path); // a plain Import from the list
        return;
    }
    const GenerationFollowUp followUp = it.value();
    m_followUps.erase(it);
    resetGeneration();

    qInfo("New model ready: %s", qPrintable(QDir::toNativeSeparators(path)));
    if (followUp.copy != GenerationFollowUp::Copy::None) emit saveCopyRequested(path, followUp);
    if (followUp.importIntoScene) emit importRequested(path);
}

QString RemoteModelsPanel::cachePath(const RemoteJob& job) const {
    QString name = SafeFileName(job.displayName());
    if (name.isEmpty()) name = job.id.left(8);
    // The file name becomes the model's name in the scene.
    return m_client->cacheDir() + "/" + SafeFileName(job.id) + "/" + name + ".ply";
}
