/*!************************************************************************
\file TrimDialog.cpp
\brief
Implements TrimDialog.
**************************************************************************/
#include "ui/TrimDialog.h"

#include <QDialogButtonBox>
#include <QDoubleSpinBox>
#include <QFormLayout>
#include <QLabel>
#include <QPushButton>
#include <QSpinBox>
#include <QVBoxLayout>

TrimDialog::TrimDialog(const SplatTrimSettings& initial, ApplyCallback onApply, QWidget* parent)
    : QDialog(parent), m_onApply(std::move(onApply)) {
    setWindowTitle("Trim Settings");

    auto* layout = new QVBoxLayout(this);
    auto* intro = new QLabel("Removes unnecessary splats. Apply re-trims the selected model from its "
                             "original data and uses these values for future imports. Lower the "
                             "values (or set them to 0) to keep more detail.", this);
    intro->setWordWrap(true);
    layout->addWidget(intro);

    auto* form = new QFormLayout();
    m_minAlpha = new QDoubleSpinBox(this);
    m_minAlpha->setDecimals(3);
    m_minAlpha->setRange(0.0, 1.0);
    m_minAlpha->setSingleStep(0.005);
    m_minAlpha->setToolTip("Remove splats more transparent than this (0 = off)");
    form->addRow("Min opacity", m_minAlpha);

    m_cropPct = new QDoubleSpinBox(this);
    m_cropPct->setDecimals(2);
    m_cropPct->setRange(0.0, 20.0);
    m_cropPct->setSingleStep(0.05);
    m_cropPct->setSuffix(" %");
    m_cropPct->setToolTip("Remove this percentage of the furthest splats at each end of every axis (0 = off)");
    form->addRow("Edge crop", m_cropPct);

    m_voxelDivisions = new QSpinBox(this);
    m_voxelDivisions->setRange(0, 1000);
    m_voxelDivisions->setToolTip("Density grid resolution across the scene. Higher = smaller cells = "
                                 "removes less (0 = density filter off)");
    form->addRow("Density grid", m_voxelDivisions);

    m_minPerVoxel = new QSpinBox(this);
    m_minPerVoxel->setRange(1, 100);
    m_minPerVoxel->setToolTip("Remove splats in grid cells holding fewer splats than this (1 = off)");
    form->addRow("Min splats per cell", m_minPerVoxel);
    layout->addLayout(form);

    auto* buttons = new QDialogButtonBox(QDialogButtonBox::Apply | QDialogButtonBox::RestoreDefaults |
                                         QDialogButtonBox::Close, this);
    layout->addWidget(buttons);
    connect(buttons->button(QDialogButtonBox::Apply), &QPushButton::clicked, this,
            [this] { m_onApply(current()); });
    connect(buttons->button(QDialogButtonBox::RestoreDefaults), &QPushButton::clicked, this,
            [this] { load(SplatTrimSettings{}); });
    connect(buttons, &QDialogButtonBox::rejected, this, &QDialog::close);

    load(initial);
}

void TrimDialog::load(const SplatTrimSettings& settings) {
    m_minAlpha->setValue(settings.minAlpha);
    m_cropPct->setValue(settings.cropPct);
    m_voxelDivisions->setValue(settings.voxelDivisions);
    m_minPerVoxel->setValue(settings.minPerVoxel);
}

SplatTrimSettings TrimDialog::current() const {
    SplatTrimSettings settings;
    settings.minAlpha = static_cast<float>(m_minAlpha->value());
    settings.cropPct = static_cast<float>(m_cropPct->value());
    settings.voxelDivisions = m_voxelDivisions->value();
    settings.minPerVoxel = m_minPerVoxel->value();
    return settings;
}
