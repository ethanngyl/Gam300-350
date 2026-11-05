/*!************************************************************************
\file InspectorPanel.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Implements InspectorPanel: the "nothing selected" state and the property
form (name, splat count, X/Y/Z position, Reset Position, trim values) bound
to a SplatModel.
**************************************************************************/
#include "ui/InspectorPanel.h"

#include "splat/SplatModel.h"

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <QButtonGroup>
#include <QDoubleSpinBox>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QLocale>
#include <QPushButton>
#include <QSignalBlocker>
#include <QSpinBox>
#include <QStackedWidget>
#include <QVBoxLayout>

#include <algorithm>
#include <cmath>

namespace {
    constexpr double kPositionRange = 1000.0;
    constexpr double kPositionStep = 0.1;  // matches the viewport's WASD nudge
    constexpr int kPositionDecimals = 3;

    // Scale can't reach 0 or go negative: the scale is read back as the length of each matrix column,
    // and a zero length column has no direction left to rebuild it from.
    constexpr double kScaleMin = 0.001;
    constexpr double kScaleMax = 1000.0;
    constexpr double kScaleStep = 0.1;
    constexpr int kScaleDecimals = 3;

    constexpr double kRotationRange = 360.0; // degrees
    constexpr double kRotationStep = 1.0;
    constexpr int kRotationDecimals = 2;

    // The rotation of a model matrix: its axis columns made orthonormal (Gram-Schmidt, in X, Y, Z order).
    // For a matrix of just rotation and scale this is the rotation itself. If the columns are skewed (shear) the
    // skew is left out, so the result is always a clean rotation.
    // False if an axis has collapsed to nothing, which leaves no direction to read.
    bool ExtractRotation(const glm::mat4& transform, glm::mat3& rotation) {
        for (int axis = 0; axis < 3; ++axis) {
            glm::vec3 column(transform[axis]);
            for (int done = 0; done < axis; ++done) {
                column -= glm::dot(column, rotation[done]) * rotation[done];
            }
            const float length = glm::length(column);
            if (length < 1e-8f) return false;
            rotation[axis] = column / length;
        }
        return true;
    }

    //Rotation for Euler angles in degrees. glm::quat(vec3) and glm::eulerAngles(quat) are inverses of each other
    //The fields and the matrix use one convention.
    glm::mat3 RotationFromDegrees(const glm::vec3& degrees) {
        return glm::mat3_cast(glm::quat(glm::radians(degrees)));
    }

    // Largest difference between any two matching entries
    float MaxDifference(const glm::mat3& a, const glm::mat3& b) {
        float largest = 0.0f;
        for (int column = 0; column < 3; ++column) {
            const glm::vec3 difference = glm::abs(a[column] - b[column]);
            largest = std::max(largest, std::max(difference.x, std::max(difference.y, difference.z)));
        }
        return largest;
    }

    // Axis label colours, the usual X = red, Y = green, Z = blue convention.
    constexpr const char* kAxisNames[3] = { "X", "Y", "Z" };
    constexpr const char* kAxisColours[3] = { "#e0605a", "#7cc35a", "#5a8fe0" };
}

InspectorPanel::InspectorPanel(QWidget* parent)
    : QWidget(parent) {
    auto* outer = new QVBoxLayout(this);
    outer->setContentsMargins(0, 0, 0, 0);
    m_stack = new QStackedWidget(this);
    outer->addWidget(m_stack);

    // Page 0: nothing selected.
    auto* emptyState = new QLabel("Select a model in the Scene panel\nto view its properties.", m_stack);
    emptyState->setObjectName("EmptyState");
    emptyState->setAlignment(Qt::AlignCenter);
    m_stack->addWidget(emptyState);

    // Page 1: the selected model's properties.
    auto* page = new QWidget(m_stack);
    auto* layout = new QVBoxLayout(page);
    layout->setContentsMargins(8, 8, 8, 8);

    auto* modelHeader = new QLabel("Model", page);
    modelHeader->setObjectName("SectionHeader");
    layout->addWidget(modelHeader);

    auto* form = new QFormLayout();
    form->setLabelAlignment(Qt::AlignRight | Qt::AlignVCenter);
    m_name = new QLineEdit(page);
    m_splatCount = new QLabel(page);
    form->addRow("Name", m_name);
    form->addRow("Splats", m_splatCount);
    layout->addLayout(form);

    auto* transformHeader = new QLabel("Transform", page);
    transformHeader->setObjectName("SectionHeader");
    layout->addWidget(transformHeader);

    //<<POSITION>>
    auto* positionRow = new QHBoxLayout();
    positionRow->setSpacing(4);
    for (int axis = 0; axis < 3; ++axis) {
        auto* label = new QLabel(kAxisNames[axis], page);
        label->setStyleSheet(QString("color: %1; font-weight: bold;").arg(kAxisColours[axis]));
        auto* spin = new QDoubleSpinBox(page);
        spin->setRange(-kPositionRange, kPositionRange);
        spin->setSingleStep(kPositionStep);
        spin->setDecimals(kPositionDecimals);
        spin->setKeyboardTracking(false); // apply on Enter / focus out / arrows, not every keystroke
        spin->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
        m_position[axis] = spin;
        positionRow->addWidget(label);
        positionRow->addWidget(spin, 1);
        connect(spin, &QDoubleSpinBox::valueChanged, this, [this] { writePosition(); });
    }
    auto* positionForm = new QFormLayout();
    positionForm->setLabelAlignment(Qt::AlignRight | Qt::AlignVCenter);
    positionForm->addRow("Position", positionRow);
    layout->addLayout(positionForm);

    //<<ROTATION>>
    auto* rotationRow = new QHBoxLayout();
    rotationRow->setSpacing(4);
    for (int axis = 0; axis < 3; ++axis) {
        auto* label = new QLabel(kAxisNames[axis], page);
        label->setStyleSheet(QString("color: %1; font-weight: bold;").arg(kAxisColours[axis]));
        auto* spin = new QDoubleSpinBox(page);
        spin->setRange(-kRotationRange, kRotationRange);
        spin->setSingleStep(kRotationStep);
        spin->setDecimals(kRotationDecimals);
        spin->setKeyboardTracking(false); //apply on Enter / focus out / arrows, not every keystroke
        spin->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
        m_rotation[axis] = spin;
        rotationRow->addWidget(label);
        rotationRow->addWidget(spin, 1);
        connect(spin, &QDoubleSpinBox::valueChanged, this, [this, axis] { writeRotation(axis); });
    }
    auto* rotationForm = new QFormLayout();
    rotationForm->setLabelAlignment(Qt::AlignRight | Qt::AlignVCenter);
    rotationForm->addRow("Rotation", rotationRow);
    layout->addLayout(rotationForm);

    //<<SCALE>>
    auto* scaleRow = new QHBoxLayout();
    scaleRow->setSpacing(4);
    for (int axis = 0; axis < 3; ++axis) {
        auto* label = new QLabel(kAxisNames[axis], page);
        label->setStyleSheet(QString("color: %1; font-weight: bold;").arg(kAxisColours[axis]));
        auto* spin = new QDoubleSpinBox(page);
        spin->setRange(kScaleMin, kScaleMax);
        spin->setSingleStep(kScaleStep);
        spin->setDecimals(kScaleDecimals);
        spin->setValue(1.0);
        spin->setKeyboardTracking(false); // apply on Enter / focus out / arrows, not every keystroke
        spin->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
        m_scale[axis] = spin;
        scaleRow->addWidget(label);
        scaleRow->addWidget(spin, 1);
        connect(spin, &QDoubleSpinBox::valueChanged, this, [this, axis] { writeScale(axis); });
    }
    auto* scaleForm = new QFormLayout();
    scaleForm->setLabelAlignment(Qt::AlignRight | Qt::AlignVCenter);
    scaleForm->addRow("Scale", scaleRow);
    layout->addLayout(scaleForm);

    auto* resetButton = new QPushButton("Reset Position", page);
    layout->addWidget(resetButton, 0, Qt::AlignRight);

    QFrame* linePosition = new QFrame(this);
    linePosition->setFrameShape(QFrame::HLine); //QFrame::VLine for vertical
    linePosition->setFrameShadow(QFrame::Sunken);
    layout->addWidget(linePosition);

    //---BOUNDING BOX---
    auto* cropHeader = new QLabel("Crop Box", page);
    cropHeader->setObjectName("SectionHeader");
    layout->addWidget(cropHeader);

    m_cropToggle = new QPushButton("Show Crop Box", page);
    m_cropToggle->setCheckable(true);
    m_cropToggle->setToolTip("Show a box around this model to select splats (Ctrl+B). Esc hides it");
    layout->addWidget(m_cropToggle);

    //Shows the current mode, clicking it switches to the other one
    m_cropModeToggle = new QPushButton(page);
    layout->addWidget(m_cropModeToggle);

    //Which side of the box a crop removes. Only matters in Crop mode, so they are exclusive
    auto* cutRow = new QHBoxLayout();
    cutRow->setSpacing(4);
    auto* cutGroup = new QButtonGroup(this);
    cutGroup->setExclusive(true);
    const char* const cutLabels[2] = { "Cut Inside", "Cut Outside" };
    const char* const cutTips[2] = { "Crop removes the splats inside the box", "Crop removes everything outside the box" };
    for (int side = 0; side < 2; ++side) {
        auto* button = new QPushButton(cutLabels[side], page);
        button->setCheckable(true);
        button->setToolTip(cutTips[side]);
        cutGroup->addButton(button, side);
        cutRow->addWidget(button);
        m_cropCutButtons[side] = button;
    }
    layout->addLayout(cutRow);

    m_cropApply = new QPushButton(page);
    m_cropApply->setToolTip("Enter, with the viewport focused");
    layout->addWidget(m_cropApply);

    connect(m_cropToggle, &QPushButton::clicked, this, [this](bool on) { emit cropBoxToggled(on); });
    //Button ids are the CropRemoveInside / CropRemoveOutside values
    connect(cutGroup, &QButtonGroup::idClicked, this, [this](int side) { emit cropModeSelected(side); });
    connect(m_cropModeToggle, &QPushButton::clicked, this, [this] {
        if (m_cropMove) emit cropModeSelected(m_cropRemoveInside ? CropRemoveInside : CropRemoveOutside); // back to Crop
        else emit cropModeSelected(CropMoveContents);
    });
    connect(m_cropApply, &QPushButton::clicked, this, [this] { emit cropApplyRequested(); });
    setCropState(false, false, true, false);

    QFrame* lineCrop = new QFrame(this);
    lineCrop->setFrameShape(QFrame::HLine); //QFrame::VLine for vertical
    lineCrop->setFrameShadow(QFrame::Sunken);
    layout->addWidget(lineCrop);

    //---TRIMMING---
    auto* trimHeader = new QLabel("Trim", page);
    trimHeader->setObjectName("SectionHeader");
    layout->addWidget(trimHeader);

    auto* trimForm = new QFormLayout();
    trimForm->setLabelAlignment(Qt::AlignRight | Qt::AlignVCenter);
    m_minAlpha = new QDoubleSpinBox(page);
    m_minAlpha->setDecimals(3);
    m_minAlpha->setRange(0.0, 1.0);
    m_minAlpha->setSingleStep(0.005);
    m_minAlpha->setToolTip("Remove splats more transparent than this (0 = off)");
    trimForm->addRow("Min opacity", m_minAlpha);

    m_cropPct = new QDoubleSpinBox(page);
    m_cropPct->setDecimals(2);
    m_cropPct->setRange(0.0, 20.0);
    m_cropPct->setSingleStep(0.05);
    m_cropPct->setSuffix(" %");
    m_cropPct->setToolTip("Remove this percentage of the furthest splats at each end of every axis (0 = off)");
    trimForm->addRow("Edge crop", m_cropPct);

    m_voxelDivisions = new QSpinBox(page);
    m_voxelDivisions->setRange(0, 1000);
    m_voxelDivisions->setToolTip("Density grid resolution across the scene. Higher = smaller cells = "
                                 "removes less (0 = density filter off)");
    trimForm->addRow("Density grid", m_voxelDivisions);

    m_minPerVoxel = new QSpinBox(page);
    m_minPerVoxel->setRange(1, 100);
    m_minPerVoxel->setToolTip("Remove splats in grid cells holding fewer splats than this (1 = off)");
    trimForm->addRow("Min per cell", m_minPerVoxel);

    m_trimStatus = new QLabel(page);
    trimForm->addRow("Status", m_trimStatus);
    layout->addLayout(trimForm);

    auto* trimButtons = new QHBoxLayout();
    auto* trimDefaultsButton = new QPushButton("Defaults", page);
    trimDefaultsButton->setToolTip("Fill the fields with the global defaults (Edit > Trim Settings)");
    auto* trimApplyButton = new QPushButton("Apply", page);
    trimApplyButton->setToolTip("Re-trim this model from its original data with these values");
    m_untrimButton = new QPushButton("Untrim", page);
    m_untrimButton->setToolTip("Restore this model's original, untrimmed splats");
    trimButtons->addStretch();
    trimButtons->addWidget(m_untrimButton);
    trimButtons->addWidget(trimDefaultsButton);
    trimButtons->addWidget(trimApplyButton);
    layout->addLayout(trimButtons);

    auto* hint = new QLabel("Tip: with the viewport focused, WASD / arrow keys nudge the "
                            "selected model.", page);
    hint->setObjectName("PanelHint");
    hint->setWordWrap(true);
    layout->addWidget(hint);
    layout->addStretch();

    m_stack->addWidget(page);

    connect(m_name, &QLineEdit::editingFinished, this, [this] {
        const QString name = m_name->text().trimmed();
        if (!m_model || name.isEmpty() || name.toStdString() == m_model->GetName()) {
            if (m_model) m_name->setText(QString::fromStdString(m_model->GetName())); //undo blank names
            return;
        }
        emit nameChanged(name);
    });

    connect(trimApplyButton, &QPushButton::clicked, this, [this] {
        if (m_model) emit trimApplyRequested(currentTrim());
    });
    connect(m_untrimButton, &QPushButton::clicked, this, [this] {
        if (m_model) emit untrimRequested();
    });
    connect(trimDefaultsButton,&QPushButton::clicked, this, [this] { loadTrimFields(m_defaultTrim); });

    //MainWindow's Reset Position action does the work, so the button and the menu cannot drift apart
    connect(resetButton, &QPushButton::clicked, this, &InspectorPanel::resetPositionRequested);

    setModel(nullptr);
}

void InspectorPanel::setModel(SplatModel* model) {
    m_model = model;
    m_stack->setCurrentIndex(model ? 1 : 0);
    if (!model) {
        return;
    }
    {
        const QSignalBlocker block(m_name);
        m_name->setText(QString::fromStdString(model->GetName()));
    }
    m_splatCount->setText(QLocale().toString(static_cast<qulonglong>(model->GetCount())));
    loadTrim();
    syncFromModel();
}

void InspectorPanel::setDefaultTrim(const TrimData& trim) {
    m_defaultTrim = trim;
}

void InspectorPanel::refreshTrim() {
    if (!m_model) {
        return;
    }
    m_splatCount->setText(QLocale().toString(static_cast<qulonglong>(m_model->GetCount())));
    loadTrim();
}

void InspectorPanel::loadTrim() {
    loadTrimFields(m_model->GetTrimData());
    m_untrimButton->setEnabled(m_model->IsTrimmed());
    if (m_model->IsTrimmed()) {
        const qulonglong total = m_model->SourceSplats().size();
        m_trimStatus->setText(QString("Kept %1 of %2")
                                  .arg(QLocale().toString(static_cast<qulonglong>(m_model->GetCount())),
                                       QLocale().toString(total)));
    } else {
        m_trimStatus->setText("Not trimmed");
    }
}

void InspectorPanel::loadTrimFields(const TrimData& trim) {
    const QSignalBlocker blockAlpha(m_minAlpha);
    const QSignalBlocker blockCrop(m_cropPct);
    const QSignalBlocker blockDivisions(m_voxelDivisions);
    const QSignalBlocker blockMin(m_minPerVoxel);
    m_minAlpha->setValue(trim.minAlpha);
    m_cropPct->setValue(trim.cropPct);
    m_voxelDivisions->setValue(trim.voxelDivisions);
    m_minPerVoxel->setValue(trim.minPerVoxel);
}

TrimData InspectorPanel::currentTrim() const {
    TrimData trim;
    trim.minAlpha = static_cast<float>(m_minAlpha->value());
    trim.cropPct = static_cast<float>(m_cropPct->value());
    trim.voxelDivisions = m_voxelDivisions->value();
    trim.minPerVoxel = m_minPerVoxel->value();
    return trim;
}

void InspectorPanel::syncFromModel() {
    if (!m_model) {
        return;
    }
    //The translation lives in the last column of the model matrix.
    const glm::vec4 translation = m_model->GetTransform()[3];
    for (int axis = 0; axis < 3; ++axis) {
        QDoubleSpinBox* spin = m_position[axis];
        // Compare at display precision so float noise does not cause a refresh.
        const double tolerance = 0.5 * std::pow(10.0, -kPositionDecimals);
        if (spin->hasFocus() || std::abs(spin->value() - translation[axis]) < tolerance) {
            continue; // being edited, or already current
        }
        const QSignalBlocker block(spin);
        spin->setValue(translation[axis]);
    }

    const glm::mat4 transform = m_model->GetTransform();

    // The rotation is the axis columns with the scale divided out. Several sets of Euler angles give the
    // same orientation (e.g. Y = 120 can come back as X = 180, Y = 60, Z = 180), so the fields are only
    // rewritten when they no longer describe the model. Otherwise they would jump while you edit them.
    bool rotationFocused = false;
    for (QDoubleSpinBox* spin : m_rotation) rotationFocused = rotationFocused || spin->hasFocus();
    glm::mat3 rotation;
    if (!rotationFocused && ExtractRotation(transform, rotation)) {
        const glm::vec3 shownDegrees(m_rotation[0]->value(), m_rotation[1]->value(), m_rotation[2]->value());
        if (MaxDifference(rotation, RotationFromDegrees(shownDegrees)) > 1e-3f) {
            const glm::vec3 degrees = glm::degrees(glm::eulerAngles(glm::quat_cast(rotation)));
            for (int axis = 0; axis < 3; ++axis) {
                const QSignalBlocker block(m_rotation[axis]);
                m_rotation[axis]->setValue(degrees[axis]);
            }
        }
    }

    // The scale of each axis is the length of its matrix column.
    for (int axis = 0; axis < 3; ++axis) {
        QDoubleSpinBox* spin = m_scale[axis];
        const double scale = glm::length(glm::vec3(transform[axis]));
        const double tolerance = 0.5 * std::pow(10.0, -kScaleDecimals);
        if (spin->hasFocus() || std::abs(spin->value() - scale) < tolerance) {
            continue; // being edited, or already current
        }
        const QSignalBlocker block(spin);
        spin->setValue(scale); // clamped to the spin box range, so a model scaled below 0.001 shows 0.001
    }
}

void InspectorPanel::setCropState(bool active, bool moveContents, bool removeInside, bool confirmed) {
    static_assert(CropRemoveInside == 0 && CropRemoveOutside == 1, "cut button ids follow CropMode");
    //Also called once while the section is being built (the cached values start different), so that call always applies
    if (m_cropShown && m_cropActive == active && m_cropMove == moveContents
        && m_cropRemoveInside == removeInside && m_cropConfirmed == confirmed) {
        return;
    }
    m_cropShown = true;
    m_cropActive = active;
    m_cropMove = moveContents;
    m_cropRemoveInside = removeInside;
    m_cropConfirmed = confirmed;

    {
        const QSignalBlocker blockToggle(m_cropToggle);
        m_cropToggle->setChecked(active);
    }
    m_cropToggle->setText(active ? "Hide Crop Box" : "Show Crop Box");

    //The cut side is kept while in Move mode, but only means something in Crop mode
    for (int side = 0; side < 2; ++side) {
        const QSignalBlocker block(m_cropCutButtons[side]);
        m_cropCutButtons[side]->setChecked(side == (removeInside ? CropRemoveInside : CropRemoveOutside));
        m_cropCutButtons[side]->setEnabled(!moveContents);
    }

    //Names the current mode, a click switches to the other one
    m_cropModeToggle->setText(moveContents ? "Mode: Move" : "Mode: Crop");
    m_cropModeToggle->setToolTip(moveContents
        ? "Move mode: position the box, confirm the splats inside it, then move, rotate and scale them with the gizmo.\n"
          "Click to switch to Crop mode (Ctrl+Shift+B)"
        : "Crop mode: the box removes the splats inside or outside it.\n"
          "Click to switch to Move mode (Ctrl+Shift+B)");

    //The mode can be picked before the box is shown, but there is nothing to act on until it is
    m_cropApply->setEnabled(active);
    if (moveContents) {
        m_cropApply->setText(confirmed ? "Release Selection" : "Confirm Selection");
    } else {
        m_cropApply->setText("Remove Splats");
    }
}

void InspectorPanel::writePosition() {
    if (!m_model) {
        return;
    }
    const glm::mat4 before = m_model->GetTransform();
    glm::mat4 after = before;
    after[3] = glm::vec4(static_cast<float>(m_position[0]->value()),
        static_cast<float>(m_position[1]->value()),
        static_cast<float>(m_position[2]->value()), 1.0f);
    //Not applied here, listener pushes it onto the undo stack
    if (after != before) emit transformFieldEdited(m_model, before, after);
}

void InspectorPanel::writeRotation(int editedAxis)
{
    if (!m_model) {
        return;
    }
    const glm::mat4 before = m_model->GetTransform();
    glm::mat3 current;
    if (!ExtractRotation(before, current)) {
        return; //an axis has no length, so there is nothing to rotate
    }

    //Only the edited field is trusted. The others can be stale while a field has focus (sync is paused then),
    //so they come from the model's current rotation instead of being written back over a gizmo or Undo change.
    glm::vec3 degrees = glm::degrees(glm::eulerAngles(glm::quat_cast(current)));
    degrees[editedAxis] = static_cast<float>(m_rotation[editedAxis]->value());
    for (int axis = 0; axis < 3; ++axis) {
        if (axis == editedAxis) continue;
        const QSignalBlocker block(m_rotation[axis]);
        m_rotation[axis]->setValue(degrees[axis]);
    }
    const glm::mat3 wanted = RotationFromDegrees(degrees);
    //Same orientation already (e.g. the fields were just refreshed from the model), nothing to do
    if (MaxDifference(current, wanted) < 1e-4f) {
        return;
    }

    //Turn the whole matrix by the difference between the wanted and current rotation. A pure rotation of the
    //existing axes keeps their lengths (the scale) and any skew between them, where writing the wanted directions
    //straight into the columns would flatten the matrix to orthonormal. The translation column is untouched.
    const glm::mat3 turn = wanted * glm::transpose(current);
    glm::mat4 after = before;
    for (int axis = 0; axis < 3; ++axis) {
        after[axis] = glm::vec4(turn * glm::vec3(before[axis]), 0.0f);
    }
    //Not applied here, listener pushes it onto the undo stack
    if (after != before) emit transformFieldEdited(m_model, before, after);
}

void InspectorPanel::writeScale(int editedAxis)
{
    if (!m_model) {
        return;
    }
    const glm::mat4 before = m_model->GetTransform();
    glm::mat4 after = before;

    //The scale of an axis is the length of its matrix column, set it by giving the column thewanted length in the same direction.
    //Leaves the rotation and the translation alone.
    const double tolerance = 0.5 * std::pow(10.0, -kScaleDecimals);
    //Only the edited axis changes. The other fields are clamped to the spin range, so an axis outside it
    //(e.g. 0.0001 from the gizmo) would otherwise be snapped to the clamped value when a different axis is edited.
    const glm::vec3 column(before[editedAxis]);
    const float length = glm::length(column);
    const double wanted = m_scale[editedAxis]->value();
    //Skip a column with no direction left, or one already at the wanted length
    if (length < 1e-8f || std::abs(wanted - length) < tolerance) {
        return;
    }
    after[editedAxis] = glm::vec4(column / length * static_cast<float>(wanted), 0.0f);
    //Not applied here, listener pushes it onto the undo stack
    if (after != before) emit transformFieldEdited(m_model, before, after);
}
