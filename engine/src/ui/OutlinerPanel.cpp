/*!************************************************************************
\file OutlinerPanel.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Implements OutlinerPanel: the model list, its empty state, inline rename
(F2, double-click or the right-click menu), and the right-click Rename/Delete menu.
**************************************************************************/
#include "ui/OutlinerPanel.h"

#include "splat/SplatRenderer.h"

#include <QHeaderView>
#include <QLabel>
#include <QLocale>
#include <QMenu>
#include <QStackedWidget>
#include <QTreeWidget>
#include <QVBoxLayout>

namespace {
    enum Column { kNameColumn = 0, kSplatsColumn = 1 };

    // Role under which each row stashes its renderer model index.
    constexpr int kIndexRole = Qt::UserRole;
    constexpr int kHiddenRole = Qt::UserRole + 1;
}

OutlinerPanel::OutlinerPanel(QWidget* parent)
    : QWidget(parent) {
    auto* layout = new QVBoxLayout(this);
    layout->setContentsMargins(4, 4, 4, 4);
    layout->setSpacing(4);

    m_summary = new QLabel(this);
    m_summary->setObjectName("PanelHint");
    layout->addWidget(m_summary);

    m_stack = new QStackedWidget(this);

    auto* emptyState = new QLabel(
        "No models in the scene.\n\n"
        "Double-click a .ply in the Assets panel,\n"
        "use File > Import Splat (Ctrl+O),\n"
        "or drag a .ply onto the window.", m_stack);
    emptyState->setObjectName("EmptyState");
    emptyState->setAlignment(Qt::AlignCenter);
    emptyState->setWordWrap(true);
    m_stack->addWidget(emptyState);

    m_tree = new QTreeWidget(m_stack);
    m_tree->setColumnCount(2);
    m_tree->setHeaderLabels({ "Name", "Splats" });
    m_tree->setRootIsDecorated(false);
    m_tree->setUniformRowHeights(true);
    m_tree->setSelectionMode(QAbstractItemView::SingleSelection);
    m_tree->setEditTriggers(QAbstractItemView::EditKeyPressed | QAbstractItemView::SelectedClicked);
    m_tree->setContextMenuPolicy(Qt::CustomContextMenu);
    m_tree->header()->setSectionResizeMode(kNameColumn, QHeaderView::Stretch);
    m_tree->header()->setSectionResizeMode(kSplatsColumn, QHeaderView::ResizeToContents);
    m_tree->header()->setStretchLastSection(false);
    m_stack->addWidget(m_tree);

    layout->addWidget(m_stack, 1);

    connect(m_tree, &QTreeWidget::itemSelectionChanged, this, [this] {
        if (!m_rebuilding) {
            emit selectionChanged(selectedIndex());
        }
    });

    connect(m_tree, &QTreeWidget::itemChanged, this, [this](QTreeWidgetItem* item, int column) {
        if (m_rebuilding || column != kNameColumn) {
            return;
        }
        emit renameRequested(item->data(kNameColumn, kIndexRole).toInt(), item->text(kNameColumn).trimmed());
    });

    //Double-click the name to rename. Done here rather than with the DoubleClicked edit trigger, which would also open an editor on the Splats column.
    connect(m_tree, &QTreeWidget::itemDoubleClicked, this, [this](QTreeWidgetItem* item, int column) {
        if (column == kNameColumn) {
            m_tree->editItem(item, kNameColumn);
        }
    });

    connect(m_tree, &QTreeWidget::customContextMenuRequested, this, [this](const QPoint& pos) {
        QTreeWidgetItem* item = m_tree->itemAt(pos);
        if (!item) {
            return;
        }
        m_tree->setCurrentItem(item);
        const int index = item->data(kNameColumn, kIndexRole).toInt();

        const bool hidden = item->data(kNameColumn, kHiddenRole).toBool();

        QMenu menu(this);
        menu.addAction("Rename", this, [this] { editSelectedName(); });
        menu.addAction(hidden ? "Show" : "Hide", this, [this, index] { emit toggleHiddenRequested(index); });
        menu.addAction("Export...", this, [this, index] { emit exportRequested(index); });
        menu.addSeparator();
        menu.addAction("Delete", this, [this, index] { emit deleteRequested(index); });
        menu.exec(m_tree->viewport()->mapToGlobal(pos));
    });
}

void OutlinerPanel::rebuild(SplatRenderer& renderer) {
    m_rebuilding = true;
    m_tree->clear();

    const QLocale locale;
    const int count = static_cast<int>(renderer.ModelCount());
    for (int i = 0; i < count; ++i) {
        auto* item = new QTreeWidgetItem(m_tree);
        item->setText(kNameColumn, QString::fromStdString(renderer.GetModelName(i)));
        item->setData(kNameColumn, kIndexRole, i);
        item->setText(kSplatsColumn, locale.toString(static_cast<qulonglong>(renderer.GetSplatCount(i))));
        item->setTextAlignment(kSplatsColumn, Qt::AlignRight | Qt::AlignVCenter);
        item->setFlags(item->flags() | Qt::ItemIsEditable);

        // Hidden models stay listed, drawn greyed out and in italics.
        const SplatModel* model = renderer.GetModel(i);
        const bool hidden = model && model->GetIsHidden();
        item->setData(kNameColumn, kHiddenRole, hidden);
        if (hidden) {
            QFont font = item->font(kNameColumn);
            font.setItalic(true);
            for (int column : { int(kNameColumn), int(kSplatsColumn) }) {
                item->setFont(column, font);
                item->setForeground(column, palette().color(QPalette::Disabled, QPalette::Text));
            }
            item->setToolTip(kNameColumn, "Hidden - right-click > Show, or press Ctrl+H");
        }
        if (renderer.GetSelectedModel() == i) {
            item->setSelected(true);
            m_tree->setCurrentItem(item);
        }
    }

    m_stack->setCurrentIndex(count > 0 ? 1 : 0);
    m_summary->setText(QString("%1 / %2 models  |  %3 splats")
                           .arg(count)
                           .arg(SplatRenderer::kMaxModels)
                           .arg(locale.toString(static_cast<qulonglong>(renderer.TotalSplatCount()))));
    m_rebuilding = false;
}

void OutlinerPanel::editSelectedName() {
    const QList<QTreeWidgetItem*> selected = m_tree->selectedItems();
    if (!selected.isEmpty()) {
        m_tree->editItem(selected.front(), kNameColumn);
    }
}

int OutlinerPanel::selectedIndex() const {
    const QList<QTreeWidgetItem*> selected = m_tree->selectedItems();
    return selected.isEmpty() ? -1 : selected.front()->data(kNameColumn, kIndexRole).toInt();
}
