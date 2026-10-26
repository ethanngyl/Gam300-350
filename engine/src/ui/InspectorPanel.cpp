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
            if (m_model) m_name->setText(QString::fromStdString(m_model->GetName())); // undo blank names
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
        glm::mat4 transform = m_model->GetTransform();
        transform[3] = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
        m_model->SetTransform(transform);
        syncFromModel();
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
    // The translation lives in the last column of the model matrix.
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

void InspectorPanel::writePosition() {
    if (!m_model) {
        return;
    }
    glm::mat4 transform = m_model->GetTransform();
    transform[3] = glm::vec4(static_cast<float>(m_position[0]->value()),
                             static_cast<float>(m_position[1]->value()),
                             static_cast<float>(m_position[2]->value()), 1.0f);
    m_model->SetTransform(transform);
}
