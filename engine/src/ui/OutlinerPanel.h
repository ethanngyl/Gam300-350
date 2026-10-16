/*!************************************************************************
\file OutlinerPanel.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Declares OutlinerPanel, the editor's "Scene" dock contents: one row per
splat model loaded in the SplatRenderer (name + splat count). It mirrors
the renderer's selection, supports inline rename, and asks the main window
to select / rename / delete models through signals. The renderer stays the
single source of truth; call rebuild() whenever the model list changes.
**************************************************************************/
#pragma once

#include <QWidget>

class QLabel;
class QStackedWidget;
class QTreeWidget;
class SplatRenderer;

class OutlinerPanel : public QWidget {
    Q_OBJECT

public:
    explicit OutlinerPanel(QWidget* parent = nullptr);

    // Repopulates the rows from the renderer and re-applies its selection.
    void rebuild(SplatRenderer& renderer);

    // Starts inline editing of the selected row's name (Edit > Rename).
    void editSelectedName();

signals:
    void selectionChanged(int modelIndex); // -1 = nothing selected
    void renameRequested(int modelIndex, const QString& name);
    void deleteRequested(int modelIndex);

private:
    int selectedIndex() const;

    QStackedWidget* m_stack = nullptr; // empty-state hint vs. the tree
    QTreeWidget* m_tree = nullptr;
    QLabel* m_summary = nullptr;
    bool m_rebuilding = false;         // suppresses signals while repopulating
};
