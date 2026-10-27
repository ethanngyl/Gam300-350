/*!************************************************************************
\file InspectorPanel.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Declares InspectorPanel, the editor's "Inspector" dock contents: the
properties of the selected splat model (name, splat count, position, trim
values). Name and position edits
are written straight into the SplatModel; syncFromModel() pulls changes made
elsewhere (e.g. WASD nudges in the viewport) back into the fields.
**************************************************************************/
#pragma once

#include "splat/SplatTrimmer.h"

#include <QWidget>

#include <array>

class QDoubleSpinBox;
class QLabel;
class QLineEdit;
class QPushButton;
class QSpinBox;
class QStackedWidget;
class SplatModel;

class InspectorPanel : public QWidget {
    Q_OBJECT

public:
    explicit InspectorPanel(QWidget* parent = nullptr);

    // The model to inspect (nullptr = nothing selected). The pointer must be
    // reset before the model is destroyed.
    void setModel(SplatModel* model);

    // The global default trim values the Defaults button fills in.
    void setDefaultTrim(const TrimData& trim);

    // Reloads the splat count and trim fields/status after the model was re-trimmed.
    void refreshTrim();

    // Refreshes the fields from the model, skipping any field being edited.
    // Cheap enough to call every frame.
    void syncFromModel();

signals:
    // The model's name was changed from the inspector.
    void nameChanged(const QString& name);

    // Apply was pressed in the Trim section; the model should be re-trimmed
    // from its original data with these values.
    void trimApplyRequested(const TrimData& trim);

    // Untrim was pressed; the model should go back to its original splats.
    void untrimRequested();

private:
    void writePosition();
    void loadTrim();            // fills the trim fields and status from the model
    void loadTrimFields(const TrimData& trim);
    TrimData currentTrim() const;

    QStackedWidget* m_stack = nullptr; // "nothing selected" vs. the properties
    QLineEdit* m_name = nullptr;
    QLabel* m_splatCount = nullptr;
    std::array<QDoubleSpinBox*, 3> m_position{};

    QDoubleSpinBox* m_minAlpha = nullptr;
    QDoubleSpinBox* m_cropPct = nullptr;
    QSpinBox* m_voxelDivisions = nullptr;
    QSpinBox* m_minPerVoxel = nullptr;
    QLabel* m_trimStatus = nullptr;
    QPushButton* m_untrimButton = nullptr;
    TrimData m_defaultTrim;

    SplatModel* m_model = nullptr;
};
