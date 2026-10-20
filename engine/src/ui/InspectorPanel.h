/*!************************************************************************
\file InspectorPanel.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Declares InspectorPanel, the editor's "Inspector" dock contents: the
properties of the selected splat model (name, splat count, position). Edits
are written straight into the SplatModel; syncFromModel() pulls changes made
elsewhere (e.g. WASD nudges in the viewport) back into the fields.
**************************************************************************/
#pragma once

#include <QWidget>

#include <array>

class QDoubleSpinBox;
class QLabel;
class QLineEdit;
class QStackedWidget;
class SplatModel;

class InspectorPanel : public QWidget {
    Q_OBJECT

public:
    explicit InspectorPanel(QWidget* parent = nullptr);

    // The model to inspect (nullptr = nothing selected). The pointer must be
    // reset before the model is destroyed.
    void setModel(SplatModel* model);

    // Refreshes the fields from the model, skipping any field being edited.
    // Cheap enough to call every frame.
    void syncFromModel();

signals:
    // The model's name was changed from the inspector.
    void nameChanged(const QString& name);

private:
    void writePosition();

    QStackedWidget* m_stack = nullptr; // "nothing selected" vs. the properties
    QLineEdit* m_name = nullptr;
    QLabel* m_splatCount = nullptr;
    std::array<QDoubleSpinBox*, 3> m_position{};

    SplatModel* m_model = nullptr;
};
