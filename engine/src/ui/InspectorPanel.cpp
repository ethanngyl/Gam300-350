/*!************************************************************************
\file InspectorPanel.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Implements InspectorPanel: the "nothing selected" state and the property
form (name, splat count, X/Y/Z position, Reset Position) bound to a
SplatModel.
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
    syncFromModel();
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
