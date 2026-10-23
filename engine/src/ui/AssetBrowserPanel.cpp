/*!************************************************************************
\file AssetBrowserPanel.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Implements AssetBrowserPanel: the folder bar, name filter, .ply file list
with size/date columns and context menu, and the file-system watcher that
keeps the list current.
**************************************************************************/
#include "ui/AssetBrowserPanel.h"
#include "ui/AssetPaths.h"

#include <QDesktopServices>
#include <QDir>
#include <QFileDialog>
#include <QFileInfo>
#include <QFileSystemWatcher>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QLabel>
#include <QLineEdit>
#include <QLocale>
#include <QMenu>
#include <QPushButton>
#include <QStyle>
#include <QTreeWidget>
#include <QUrl>
#include <QVBoxLayout>

namespace {
    // Folder opened first: the bundled sample splats.
    QString DefaultSplatDir() { return AssetPaths::AssetsSubdir("samples"); }

    enum Column { kNameColumn = 0, kSizeColumn = 1, kModifiedColumn = 2 };

    // Role under which each row stashes its absolute file path.
    constexpr int kPathRole = Qt::UserRole;
    // Role holding the raw byte size, so the Size column sorts numerically.
    constexpr int kBytesRole = Qt::UserRole + 1;

    // Row type whose Size column sorts by bytes rather than by display text.
    class FileItem : public QTreeWidgetItem {
    public:
        using QTreeWidgetItem::QTreeWidgetItem;
        bool operator<(const QTreeWidgetItem& other) const override {
            const int column = treeWidget() ? treeWidget()->sortColumn() : kNameColumn;
            if (column == kSizeColumn) {
                return data(kSizeColumn, kBytesRole).toLongLong() <
                       other.data(kSizeColumn, kBytesRole).toLongLong();
            }
            return QTreeWidgetItem::operator<(other);
        }
    };
}

AssetBrowserPanel::AssetBrowserPanel(QWidget* parent)
    : QWidget(parent)
    , m_watcher(new QFileSystemWatcher(this)) {
    auto* layout = new QVBoxLayout(this);
    layout->setContentsMargins(4, 4, 4, 4);
    layout->setSpacing(4);

    auto* topRow = new QHBoxLayout();
    auto* browseButton = new QPushButton(style()->standardIcon(QStyle::SP_DirOpenIcon), "", this);
    browseButton->setToolTip("Choose the folder to browse");
    auto* refreshButton = new QPushButton(style()->standardIcon(QStyle::SP_BrowserReload), "", this);
    refreshButton->setToolTip("Rescan the folder");
    m_folderLabel = new QLabel(this);
    m_folderLabel->setObjectName("PanelHint");
    m_folderLabel->setTextInteractionFlags(Qt::TextSelectableByMouse);
    m_search = new QLineEdit(this);
    m_search->setPlaceholderText("Filter by name...");
    m_search->setClearButtonEnabled(true);
    m_search->setMaximumWidth(220);
    m_importButton = new QPushButton("Import", this);
    m_importButton->setToolTip("Load the selected .ply into the scene");

    topRow->addWidget(browseButton);
    topRow->addWidget(refreshButton);
    topRow->addWidget(m_folderLabel, 1);
    topRow->addWidget(m_search);
    topRow->addWidget(m_importButton);
    layout->addLayout(topRow);

    m_files = new QTreeWidget(this);
    m_files->setColumnCount(3);
    m_files->setHeaderLabels({ "Name", "Size", "Modified" });
    m_files->setRootIsDecorated(false);
    m_files->setAlternatingRowColors(true);
    m_files->setUniformRowHeights(true);
    m_files->setSortingEnabled(true);
    m_files->sortByColumn(kNameColumn, Qt::AscendingOrder);
    m_files->setContextMenuPolicy(Qt::CustomContextMenu);
    m_files->header()->setSectionResizeMode(kNameColumn, QHeaderView::Stretch);
    m_files->header()->setSectionResizeMode(kSizeColumn, QHeaderView::ResizeToContents);
    m_files->header()->setSectionResizeMode(kModifiedColumn, QHeaderView::ResizeToContents);
    m_files->header()->setStretchLastSection(false);
    layout->addWidget(m_files, 1);

    connect(browseButton, &QPushButton::clicked, this, [this] {
        const QString dir = QFileDialog::getExistingDirectory(this, "Choose a folder of .ply splats", m_folder);
        if (!dir.isEmpty()) {
            setFolder(dir);
        }
    });
    connect(refreshButton, &QPushButton::clicked, this, [this] { refresh(); });
    connect(m_search, &QLineEdit::textChanged, this, [this] { applyFilter(); });
    connect(m_importButton, &QPushButton::clicked, this, [this] { requestImportOfCurrent(); });
    connect(m_files, &QTreeWidget::itemDoubleClicked, this, [this] { requestImportOfCurrent(); });
    connect(m_files, &QTreeWidget::currentItemChanged, this, [this] {
        m_importButton->setEnabled(m_files->currentItem() != nullptr);
    });

    connect(m_files, &QTreeWidget::customContextMenuRequested, this, [this](const QPoint& pos) {
        QTreeWidgetItem* item = m_files->itemAt(pos);
        QMenu menu(this);
        if (item) {
            // Copy the path now: the watcher may rebuild the list (deleting
            // item) while the menu's event loop is running.
            const QString path = item->data(kNameColumn, kPathRole).toString();
            QAction* import = menu.addAction("Import into Scene");
            connect(import, &QAction::triggered, this, [this, path] { emit importRequested(path); });
            menu.addSeparator();
        }
        menu.addAction("Show in Explorer", this, [this] {
            QDesktopServices::openUrl(QUrl::fromLocalFile(m_folder));
        });
        menu.addAction("Refresh", this, [this] { refresh(); });
        menu.exec(m_files->viewport()->mapToGlobal(pos));
    });

    // Rescan when files are added, removed or renamed (e.g. a fresh export
    // from the reconstruction pipeline lands in the folder).
    connect(m_watcher, &QFileSystemWatcher::directoryChanged, this, [this] { refresh(); });

    setFolder(DefaultSplatDir());
}

void AssetBrowserPanel::setFolder(const QString& requestedDir) {
    const QString dir = requestedDir.isEmpty() || !QDir(requestedDir).exists()
                            ? DefaultSplatDir() : requestedDir;

    if (!m_watcher->directories().isEmpty()) {
        m_watcher->removePaths(m_watcher->directories());
    }
    m_folder = QDir(dir).absolutePath();
    if (QDir(m_folder).exists()) {
        m_watcher->addPath(m_folder);
    }
    refresh();
}

void AssetBrowserPanel::refresh() {
    const QString previous = m_files->currentItem()
                                 ? m_files->currentItem()->data(kNameColumn, kPathRole).toString()
                                 : QString();

    m_files->setSortingEnabled(false);
    m_files->clear();

    const QFileInfoList files =
        QDir(m_folder).entryInfoList({ "*.ply" }, QDir::Files | QDir::Readable, QDir::Name | QDir::IgnoreCase);

    const QLocale locale;
    for (const QFileInfo& info : files) {
        auto* item = new FileItem(m_files);
        item->setText(kNameColumn, info.fileName());
        item->setIcon(kNameColumn, style()->standardIcon(QStyle::SP_FileIcon));
        item->setData(kNameColumn, kPathRole, info.absoluteFilePath());
        item->setToolTip(kNameColumn, QDir::toNativeSeparators(info.absoluteFilePath()));
        item->setText(kSizeColumn, locale.formattedDataSize(info.size()));
        item->setData(kSizeColumn, kBytesRole, info.size());
        item->setTextAlignment(kSizeColumn, Qt::AlignRight | Qt::AlignVCenter);
        item->setText(kModifiedColumn, locale.toString(info.lastModified(), QLocale::ShortFormat));
        if (item->data(kNameColumn, kPathRole).toString() == previous) {
            m_files->setCurrentItem(item);
        }
    }
    m_files->setSortingEnabled(true);

    m_folderLabel->setText(QString("%1  (%2 .ply file%3)")
                               .arg(QDir::toNativeSeparators(m_folder))
                               .arg(files.size())
                               .arg(files.size() == 1 ? "" : "s"));
    m_folderLabel->setToolTip(QDir::toNativeSeparators(m_folder));

    applyFilter();
    m_importButton->setEnabled(m_files->currentItem() != nullptr);
}

void AssetBrowserPanel::applyFilter() {
    const QString needle = m_search->text().trimmed();
    for (int i = 0; i < m_files->topLevelItemCount(); ++i) {
        QTreeWidgetItem* item = m_files->topLevelItem(i);
        item->setHidden(!needle.isEmpty() && !item->text(kNameColumn).contains(needle, Qt::CaseInsensitive));
    }
}

void AssetBrowserPanel::requestImportOfCurrent() {
    QTreeWidgetItem* item = m_files->currentItem();
    if (item) {
        emit importRequested(item->data(kNameColumn, kPathRole).toString());
    }
}
