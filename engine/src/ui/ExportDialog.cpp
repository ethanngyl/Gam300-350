/*!************************************************************************
\file ExportDialog.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 22-10-2026
\brief
Implements ExportDialog: the export option form, per-format descriptions,
the output size estimate, and saving/restoring the last-used options.
**************************************************************************/
#include "ui/ExportDialog.h"

#include <QComboBox>
#include <QDialogButtonBox>
#include <QDoubleSpinBox>
#include <QFormLayout>
#include <QLabel>
#include <QLocale>
#include <QPushButton>
#include <QSettings>
#include <QVBoxLayout>

namespace {
    // QSettings keys.
    const QString kFormatKey = QStringLiteral("export/format");
    const QString kGeometryKey = QStringLiteral("export/geometry");
    const QString kDetailKey = QStringLiteral("export/highDetail");
    const QString kSigmaKey = QStringLiteral("export/sigma");
    const QString kMinAlphaKey = QStringLiteral("export/minAlpha");

    constexpr ExportFormat kFormats[] = {
        ExportFormat::Glb, ExportFormat::Obj, ExportFormat::PointCloudPly,
        ExportFormat::Stl, ExportFormat::GaussianPly, ExportFormat::SplatFile,
    };

    QString FormatDescription(ExportFormat format) {
        switch (format) {
        case ExportFormat::Glb:
            return "Single-file glTF with vertex colours. Opens in Blender, Unity, Unreal, "
                   "Windows 3D Viewer and web viewers.";
        case ExportFormat::Obj:
            return "Text format with vertex colours. Opens in almost every 3D tool; large and slow "
                   "for big scans.";
        case ExportFormat::PointCloudPly:
            return "Standard coloured .ply. Opens in MeshLab, CloudCompare and Blender.";
        case ExportFormat::Stl:
            return "Triangle mesh without colour, for 3D printing and CAD.";
        case ExportFormat::GaussianPly:
            return "Gaussian splats with your trimming and position applied. Re-opens in Genesis Alpha Build and "
                   "other splat viewers. View-dependent colour (f_rest) is not kept.";
        case ExportFormat::SplatFile:
            return "Compact splat format (32 bytes per splat) used by web splat viewers.";
        }
        return QString();
    }

    std::size_t TrianglesPerSplat(bool highDetail) { return highDetail ? 20 : 8; }
    std::size_t VerticesPerSplat(bool highDetail) { return highDetail ? 12 : 6; }
}

ExportDialog::ExportDialog(const QString& selectedName, std::size_t selectedSplats, std::size_t sceneSplats,
                           QWidget* parent)
    : QDialog(parent), m_selectedSplats(selectedSplats), m_sceneSplats(sceneSplats) {
    setWindowTitle("Export");
    setMinimumWidth(460);

    auto* layout = new QVBoxLayout(this);
    auto* form = new QFormLayout();
    form->setLabelAlignment(Qt::AlignRight | Qt::AlignVCenter);

    m_source = new QComboBox(this);
    if (selectedSplats > 0) {
        m_source->addItem(QString("Selected model (%1)").arg(selectedName));
    }
    m_source->addItem("Whole scene (all models merged)");
    form->addRow("Export", m_source);

    m_format = new QComboBox(this);
    for (ExportFormat format : kFormats) {
        m_format->addItem(QString("%1  (*%2)").arg(ExportFormatName(format), ExportFormatExtension(format)),
                          static_cast<int>(format));
    }
    form->addRow("Format", m_format);

    m_description = new QLabel(this);
    m_description->setObjectName("PanelHint");
    m_description->setWordWrap(true);
    form->addRow(QString(), m_description);

    m_geometry = new QComboBox(this);
    m_geometry->addItem("Points (one vertex per splat)", static_cast<int>(ExportGeometry::Points));
    m_geometry->addItem("Mesh (one ellipsoid per splat)", static_cast<int>(ExportGeometry::Mesh));
    form->addRow("Geometry", m_geometry);

    m_detail = new QComboBox(this);
    m_detail->addItem("Low (8 triangles per splat)");
    m_detail->addItem("High (20 triangles per splat)");
    form->addRow("Mesh detail", m_detail);

    m_sigma = new QDoubleSpinBox(this);
    m_sigma->setRange(0.25, 4.0);
    m_sigma->setSingleStep(0.25);
    m_sigma->setDecimals(2);
    m_sigma->setSuffix(" σ");
    m_sigma->setToolTip("Ellipsoid radius in standard deviations of each Gaussian. "
                        "Larger values close gaps but make the surface look blobby.");
    form->addRow("Splat size", m_sigma);

    m_minAlpha = new QDoubleSpinBox(this);
    m_minAlpha->setRange(0.0, 0.99);
    m_minAlpha->setSingleStep(0.05);
    m_minAlpha->setDecimals(2);
    m_minAlpha->setToolTip("Skip splats more transparent than this. Faint splats are mostly haze "
                           "and make mesh exports much larger.");
    form->addRow("Min opacity", m_minAlpha);

    layout->addLayout(form);

    m_estimate = new QLabel(this);
    m_estimate->setWordWrap(true);
    layout->addWidget(m_estimate);

    auto* buttons = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel, this);
    buttons->button(QDialogButtonBox::Ok)->setText("Export...");
    layout->addWidget(buttons);
    connect(buttons, &QDialogButtonBox::accepted, this, &QDialog::accept);
    connect(buttons, &QDialogButtonBox::rejected, this, &QDialog::reject);

    QSettings settings;
    const int formatIndex = m_format->findData(settings.value(kFormatKey, static_cast<int>(ExportFormat::Glb)).toInt());
    m_format->setCurrentIndex(formatIndex >= 0 ? formatIndex : 0);
    const int geometryIndex = m_geometry->findData(settings.value(kGeometryKey, static_cast<int>(ExportGeometry::Mesh)).toInt());
    m_geometry->setCurrentIndex(geometryIndex >= 0 ? geometryIndex : 0);
    m_detail->setCurrentIndex(settings.value(kDetailKey, false).toBool() ? 1 : 0);
    m_sigma->setValue(settings.value(kSigmaKey, 1.5).toDouble());
    m_minAlpha->setValue(settings.value(kMinAlphaKey, 0.1).toDouble());

    for (QComboBox* combo : { m_source, m_format, m_geometry, m_detail }) {
        connect(combo, &QComboBox::currentIndexChanged, this, [this] { updateControls(); });
    }
    connect(m_minAlpha, &QDoubleSpinBox::valueChanged, this, [this] { updateControls(); });
    updateControls();
}

ExportOptions ExportDialog::options() const {
    ExportOptions options;
    options.format = static_cast<ExportFormat>(m_format->currentData().toInt());
    options.geometry = static_cast<ExportGeometry>(m_geometry->currentData().toInt());
    if (!ExportFormatSupportsMesh(options.format)) options.geometry = ExportGeometry::Points;
    if (!ExportFormatSupportsPoints(options.format)) options.geometry = ExportGeometry::Mesh;
    options.highDetailMesh = m_detail->currentIndex() == 1;
    options.sigmaScale = static_cast<float>(m_sigma->value());
    options.minAlpha = static_cast<float>(m_minAlpha->value());
    return options;
}

bool ExportDialog::wholeScene() const {
    return m_selectedSplats == 0 || m_source->currentIndex() == 1;
}

void ExportDialog::accept() {
    QSettings settings;
    settings.setValue(kFormatKey, m_format->currentData());
    settings.setValue(kGeometryKey, m_geometry->currentData());
    settings.setValue(kDetailKey, m_detail->currentIndex() == 1);
    settings.setValue(kSigmaKey, m_sigma->value());
    settings.setValue(kMinAlphaKey, m_minAlpha->value());
    QDialog::accept();
}

void ExportDialog::updateControls() {
    const ExportOptions opts = options();
    const bool splatFormat = !ExportFormatSupportsPoints(opts.format) && !ExportFormatSupportsMesh(opts.format);
    const bool mesh = opts.geometry == ExportGeometry::Mesh && !splatFormat;

    m_description->setText(FormatDescription(opts.format));
    // Only offer a choice the format actually has.
    m_geometry->setEnabled(ExportFormatSupportsPoints(opts.format) && ExportFormatSupportsMesh(opts.format));
    m_detail->setEnabled(mesh);
    m_sigma->setEnabled(mesh);

    // Upper bound: the minimum opacity removes an unknown share of splats.
    const std::size_t splats = wholeScene() ? m_sceneSplats : m_selectedSplats;
    const QLocale locale;
    QString estimate;
    if (mesh) {
        estimate = QString("Up to %1 vertices and %2 triangles")
                       .arg(locale.toString(static_cast<qulonglong>(splats * VerticesPerSplat(opts.highDetailMesh))),
                            locale.toString(static_cast<qulonglong>(splats * TrianglesPerSplat(opts.highDetailMesh))));
    } else {
        estimate = QString("Up to %1 %2").arg(locale.toString(static_cast<qulonglong>(splats)),
                                              splatFormat ? "splats" : "points");
    }
    if (opts.minAlpha > 0.0f) {
        estimate += " (fewer after the opacity filter)";
    }
    m_estimate->setText(estimate + ".");
}
