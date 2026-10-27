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
#include <QProgressBar>
#include <QPushButton>
#include <QStyle>
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

    topRow->addWidget(m_refreshButton);
    topRow->addWidget(m_accountLabel, 1);
    topRow->addWidget(m_search);
    topRow->addWidget(m_accountButton);
    topRow->addWidget(m_importButton);
    layout->addLayout(topRow);

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
            [this](const QString&, const QString& path, const QString& error) {
                m_progress->hide();
                m_cancelButton->hide();
                updateButtons();
                if (!error.isEmpty()) {
                    qWarning("Model download failed: %s", qPrintable(error));
                    m_message->setText(error);
                    m_message->show();
                    return;
                }
                m_message->hide();
                emit importRequested(path);
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
        m_message->setText("Sign in with your Codefine web app account to see the models you uploaded.");
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
        emit importRequested(path);
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

QString RemoteModelsPanel::cachePath(const RemoteJob& job) const {
    QString name = SafeFileName(job.displayName());
    if (name.isEmpty()) name = job.id.left(8);
    // The file name becomes the model's name in the scene.
    return m_client->cacheDir() + "/" + SafeFileName(job.id) + "/" + name + ".ply";
}
