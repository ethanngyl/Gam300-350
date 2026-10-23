/*!************************************************************************
\file TrimDialog.h
\brief
Declares TrimDialog, a non-modal window for editing the splat trim
settings. "Apply" saves the settings (used for later imports) and re-trims
the selected model from its original data.
**************************************************************************/
#pragma once

#include "splat/SplatTrimmer.h"

#include <QDialog>

#include <functional>

class QCheckBox;
class QDoubleSpinBox;
class QSpinBox;

class TrimDialog : public QDialog {
public:
    using ApplyCallback = std::function<void(const SplatTrimSettings&)>;

    TrimDialog(const SplatTrimSettings& initial, ApplyCallback onApply, QWidget* parent = nullptr);

private:
    void load(const SplatTrimSettings& settings);
    SplatTrimSettings current() const;

    QDoubleSpinBox* m_minAlpha = nullptr;
    QDoubleSpinBox* m_cropPct = nullptr;
    QSpinBox* m_voxelDivisions = nullptr;
    QSpinBox* m_minPerVoxel = nullptr;
    ApplyCallback m_onApply;
};
