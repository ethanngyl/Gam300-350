/*!************************************************************************
\file ExportDialog.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 22-10-2026
\brief
Declares ExportDialog, the File > Export options: what to export (the
selected model or the whole scene), the target 3D format, and for mesh
formats how each splat is turned into geometry. Shows a size estimate and
remembers the last choices with QSettings.
**************************************************************************/
#pragma once

#include "splat/SplatExporter.h"

#include <QDialog>

#include <cstddef>

class QComboBox;
class QDoubleSpinBox;
class QLabel;

class ExportDialog : public QDialog {
    Q_OBJECT

public:
    // selectedSplats = 0 means nothing is selected, so only the whole scene can be exported.
    ExportDialog(const QString& selectedName, std::size_t selectedSplats, std::size_t sceneSplats,
                 QWidget* parent = nullptr);

    ExportOptions options() const;
    bool wholeScene() const;

    void accept() override; // also saves the choices for next time

private:
    void updateControls();

    QComboBox* m_source = nullptr;
    QComboBox* m_format = nullptr;
    QComboBox* m_geometry = nullptr;
    QComboBox* m_detail = nullptr;
    QDoubleSpinBox* m_sigma = nullptr;
    QDoubleSpinBox* m_minAlpha = nullptr;
    QLabel* m_description = nullptr;
    QLabel* m_estimate = nullptr;

    std::size_t m_selectedSplats = 0;
    std::size_t m_sceneSplats = 0;
};
