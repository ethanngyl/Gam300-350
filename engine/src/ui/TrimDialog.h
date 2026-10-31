/*!************************************************************************
\file TrimDialog.h
\brief
Declares TrimDialog, a non-modal window for editing the splat trim
default values. "Apply" saves them as the global defaults used for later
imports; per-model trimming lives in the Inspector.
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
    using ApplyCallback = std::function<void(const TrimData&)>;

    TrimDialog(const TrimData& initial, ApplyCallback onApply, QWidget* parent = nullptr);

private:
    void load(const TrimData& settings);
    TrimData current() const;

    QDoubleSpinBox* m_minAlpha = nullptr;
    QDoubleSpinBox* m_cropPct = nullptr;
    QSpinBox* m_voxelDivisions = nullptr;
    QSpinBox* m_minPerVoxel = nullptr;
    ApplyCallback m_onApply;
};
