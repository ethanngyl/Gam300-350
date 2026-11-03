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

#include <cmath>

namespace {
    constexpr double kPositionRange = 1000.0;
    constexpr double kPositionStep = 0.1;  // matches the viewport's WASD nudge
    constexpr int kPositionDecimals = 3;

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

    connect(resetButton, &QPushButton::clicked, this, [this] {
        if (!m_model) return;
        const glm::mat4 before = m_model->GetTransform();
        glm::mat4 after = before;
        after[3] = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
        if (after != before) 
            emit transformEdited(m_model, before, after);
    });

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
    if (after != before) emit transformEdited(m_model, before, after);
}
