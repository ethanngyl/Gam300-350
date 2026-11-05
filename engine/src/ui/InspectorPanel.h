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

#include <glm/glm.hpp>

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

    // The modes the crop box buttons can ask for. The two cut values are the cut button ids.
    enum CropMode { CropRemoveInside = 0, CropRemoveOutside = 1, CropMoveContents = 2 };

    // Shows the real crop box state in the Crop Box section (the box can also be changed with
    // shortcuts and menus). `removeInside` is kept while in move mode, so switching back to crop
    // restores it. `confirmed` is whether move mode has a confirmed selection.
    // Cheap enough to call every frame.
    void setCropState(bool active, bool moveContents, bool removeInside, bool confirmed);

//QT's events
signals:
    // The Show Crop Box button was toggled.
    void cropBoxToggled(bool on);

    // A cut button or the mode button asked for a mode (a CropMode value).
    void cropModeSelected(int mode);

    // The action button was pressed: remove the splats, or confirm/release the selection in move-contents mode.
    void cropApplyRequested();

    // The model's name was changed from the inspector.
    void nameChanged(const QString& name);

    //The position fields or Reset Position asked to change the model transform
    //The inspector panel does not apply it, the listener does, so it can be an undo step,
    void transformEdited(SplatModel* model, const glm::mat4& before, const glm::mat4& after);

    // Apply was pressed in the Trim section; the model should be re-trimmed
    // from its original data with these values.
    void trimApplyRequested(const TrimData& trim);

    // Untrim was pressed; the model should go back to its original splats.
    void untrimRequested();

private:
    void writePosition();
    void writeScale();
    void writeRotation(int editedAxis);
    //Fills the trim fields and status from the model
    void loadTrim();
    void loadTrimFields(const TrimData& trim);
    TrimData currentTrim() const;

    QStackedWidget* m_stack = nullptr; // "nothing selected" vs. the properties
    QLineEdit* m_name = nullptr;
    QLabel* m_splatCount = nullptr;

    //Transform to display in inspect
    std::array<QDoubleSpinBox*, 3> m_position{};
    std::array<QDoubleSpinBox*, 3> m_rotation{}; // Euler angles in degrees
    std::array<QDoubleSpinBox*, 3> m_scale{};

    QDoubleSpinBox* m_minAlpha = nullptr;
    QDoubleSpinBox* m_cropPct = nullptr;
    QSpinBox* m_voxelDivisions = nullptr;
    QSpinBox* m_minPerVoxel = nullptr;
    QLabel* m_trimStatus = nullptr;
    QPushButton* m_untrimButton = nullptr;
    TrimData m_defaultTrim;

    QPushButton* m_cropToggle = nullptr;
    std::array<QPushButton*, 2> m_cropCutButtons{}; // Cut Inside, Cut Outside
    QPushButton* m_cropModeToggle = nullptr;        // shows the mode, click switches Crop <-> Move
    QPushButton* m_cropApply = nullptr;
    // Last state shown, so the per-frame setCropState only touches widgets when something changed
    bool m_cropShown = false; // false until the first setCropState has filled the widgets in
    bool m_cropActive = false;
    bool m_cropMove = false;
    bool m_cropRemoveInside = true;
    bool m_cropConfirmed = false;

    SplatModel* m_model = nullptr;
};
