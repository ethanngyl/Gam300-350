/*!************************************************************************
\file GenerateModelDialog.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
Implements GenerateModelDialog: the file list (add files / add folder /
remove), the model name, detail preset, frames per second for videos,
background removal and the after-build options, with the same rules the
backend enforces (at least 8 photos, .jpg/.png only, up to 400 photos or
10 videos) checked up front, plus a live check that this PC has the tools
to build it (COLMAP, Brush, and Python for videos / background removal).
**************************************************************************/
#include "ui/GenerateModelDialog.h"

#include "pipeline/GenerationSettings.h"

#include <QCheckBox>
#include <QComboBox>
#include <QDialogButtonBox>
#include <QDir>
#include <QDoubleSpinBox>
#include <QLocale>
#include <QSpinBox>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPushButton>
#include <QSet>
#include <QSettings>
#include <QStandardPaths>
#include <QVBoxLayout>

namespace {
    // Shared with the local and command-line builds (GenerationSettings.h).
    using generation::kDefaultFps;
    using generation::kMaxTrainIters;
    using generation::kMediaSuffixes;
    using generation::kMinTrainIters;
    using generation::kPhotoSuffixes;

    // Same limit as the web app's model names (MAX_JOB_NAME_LENGTH in services/jobs.js).
    constexpr int kMaxNameLength = 80;

    // The web app's detail presets (catalog.json trainingPresets): Brush training iterations.
    struct DetailPreset {
        const char* label;
        int iterations;
        const char* tip;
    };
    constexpr DetailPreset kPresets[] = {
        { "Low", 5000, "Quickest build, a little blurrier" },
        { "Medium", 7000, "Balanced (the web app's default)" },
        { "High", 10000, "Sharpest, takes the longest" },
    };
    constexpr int kDefaultPreset = 1;
    // Item data of the "Custom..." detail choice; the spin box then gives the count.
    constexpr int kCustomDetail = 0;

    // QSettings keys.
    const QString kSourceKey = QStringLiteral("generate/source");
    const QString kDetailKey = QStringLiteral("generate/detail");
    const QString kCustomItersKey = QStringLiteral("generate/customIters");
    const QString kFpsKey = QStringLiteral("generate/fps");
    const QString kRemoveBackgroundKey = QStringLiteral("generate/removeBackground");
    const QString kAutoCropKey = QStringLiteral("generate/autoCrop");
    const QString kImportKey = QStringLiteral("generate/import");
    const QString kCopyKey = QStringLiteral("generate/copy");
    const QString kCopyFolderKey = QStringLiteral("generate/copyFolder");
    const QString kLastFolderKey = QStringLiteral("generate/lastFolder");

    QString NameFilter(bool media) {
        const QStringList patterns = generation::NamePatterns(media ? kMediaSuffixes : kPhotoSuffixes);
        return QString("%1 (%2)").arg(media ? "Videos and GIFs" : "Photos", patterns.join(' '));
    }

    // Whether path is the kind of file this build takes (videos/GIFs or photos).
    bool FitsSource(bool media, const QString& path) {
        return media ? generation::IsMediaFile(path) : generation::IsPhotoFile(path);
    }
}

GenerateModelDialog::GenerateModelDialog(QWidget* parent)
    : QDialog(parent)
    , m_tools(LocalReconstruction::FindTools()) {
    setWindowTitle("Generate Model");
    setMinimumWidth(520);
    const QSettings settings;

    auto* layout = new QVBoxLayout(this);
    auto* intro = new QLabel("Turn photos or a video of an object into a 3D Gaussian splat model, just like the "
                             "web app. Walk all the way around the object and keep it sharp and well lit; more "
                             "overlapping shots give a better model.", this);
    intro->setWordWrap(true);
    intro->setObjectName("PanelHint");
    layout->addWidget(intro);

    auto* form = new QFormLayout();
    form->setLabelAlignment(Qt::AlignRight | Qt::AlignVCenter);

    // Built on this PC: COLMAP and Brush run here, no server or sign-in needed.
    m_toolsHint = new QLabel(this);
    m_toolsHint->setWordWrap(true);
    m_toolsHint->setObjectName("PanelHint");
    form->addRow("Build on", m_toolsHint);

    m_source = new QComboBox(this);
    m_source->addItem("Photos (.jpg, .png)");
    m_source->addItem("Videos or animated GIFs");
    m_source->setCurrentIndex(settings.value(kSourceKey, 0).toInt() == 1 ? 1 : 0);
    form->addRow("Build from", m_source);
    layout->addLayout(form);

    m_files = new QListWidget(this);
    m_files->setSelectionMode(QAbstractItemView::ExtendedSelection);
    m_files->setMinimumHeight(140);
    layout->addWidget(m_files, 1);

    auto* fileButtons = new QHBoxLayout();
    m_addFiles = new QPushButton("Add Files...", this);
    m_addFolder = new QPushButton("Add Folder...", this);
    m_remove = new QPushButton("Remove", this);
    m_clear = new QPushButton("Clear", this);
    m_fileCount = new QLabel(this);
    m_fileCount->setObjectName("PanelHint");
    fileButtons->addWidget(m_addFiles);
    fileButtons->addWidget(m_addFolder);
    fileButtons->addWidget(m_remove);
    fileButtons->addWidget(m_clear);
    fileButtons->addWidget(m_fileCount, 1, Qt::AlignRight);
    layout->addLayout(fileButtons);

    auto* options = new QFormLayout();
    options->setLabelAlignment(Qt::AlignRight | Qt::AlignVCenter);

    m_name = new QLineEdit(this);
    m_name->setMaxLength(kMaxNameLength);
    m_name->setPlaceholderText("Optional, e.g. \"Desk lamp\"");
    options->addRow("Name", m_name);

    m_detail = new QComboBox(this);
    for (const DetailPreset& preset : kPresets) {
        m_detail->addItem(QString("%1 (%2 iterations)").arg(preset.label).arg(preset.iterations), preset.iterations);
        m_detail->setItemData(m_detail->count() - 1, preset.tip, Qt::ToolTipRole);
    }
    m_detail->addItem("Custom...", kCustomDetail);
    m_detail->setItemData(m_detail->count() - 1, "Set the number of training iterations yourself", Qt::ToolTipRole);
    const int savedDetail = settings.value(kDetailKey, kDefaultPreset).toInt();
    m_detail->setCurrentIndex(savedDetail >= 0 && savedDetail < m_detail->count() ? savedDetail : kDefaultPreset);

    m_customIters = new QSpinBox(this);
    m_customIters->setRange(kMinTrainIters, kMaxTrainIters);
    m_customIters->setSingleStep(500);
    m_customIters->setGroupSeparatorShown(true);
    m_customIters->setSuffix(" iterations");
    m_customIters->setValue(settings.value(kCustomItersKey, kPresets[kDefaultPreset].iterations).toInt());
    m_customIters->setToolTip(QString("How many steps Brush trains for (%1 to %2). More is sharper but slower: "
                                      "build time grows roughly in step with it.")
                                  .arg(QLocale().toString(kMinTrainIters), QLocale().toString(kMaxTrainIters)));
    auto* detailRow = new QHBoxLayout();
    detailRow->addWidget(m_detail, 1);
    detailRow->addWidget(m_customIters);
    options->addRow("Detail", detailRow);
    const auto showCustom = [this] { m_customIters->setVisible(m_detail->currentData().toInt() == kCustomDetail); };
    showCustom();
    connect(m_detail, &QComboBox::currentIndexChanged, this, showCustom);

    m_fps = new QDoubleSpinBox(this);
    m_fps->setRange(0.5, 30.0);
    m_fps->setSingleStep(0.5);
    m_fps->setDecimals(1);
    m_fps->setSuffix(" frames / s");
    m_fps->setValue(settings.value(kFpsKey, kDefaultFps).toDouble());
    m_fps->setToolTip("How many frames are taken from each second of video. Higher = more frames = slower, "
                      "more detailed builds.");
    m_fpsLabel = new QLabel("Frames", this);
    options->addRow(m_fpsLabel, m_fps);

    m_removeBackground = new QCheckBox("Remove the background first", this);
    m_removeBackground->setToolTip("Masks out everything but the object before reconstruction. "
                                   "Use it for turntable captures where the object spins and the camera stays still.");
    m_removeBackground->setChecked(settings.value(kRemoveBackgroundKey, false).toBool());
    options->addRow("", m_removeBackground);

    m_autoCrop = new QCheckBox("Keep only the main object", this);
    m_autoCrop->setToolTip("When you walk around an object, removes everything outside the path you took "
                           "(neighbouring objects, walls, the ceiling). Skipped if the photos don't surround "
                           "one object. Turn off for rooms and scenery.");
    m_autoCrop->setChecked(settings.value(kAutoCropKey, false).toBool());
    options->addRow("", m_autoCrop);

    m_import = new QCheckBox("Import into the scene when it's ready", this);
    m_import->setChecked(settings.value(kImportKey, true).toBool());
    options->addRow("When done", m_import);

    using Copy = GenerationFollowUp::Copy;
    m_copy = new QComboBox(this);
    m_copy->addItem("Nothing else (just the .ply)", static_cast<int>(Copy::None));
    m_copy->setItemData(m_copy->count() - 1, "The Gaussian splat .ply re-opens in the engine and other splat viewers",
                        Qt::ToolTipRole);
    m_copy->addItem("Wavefront .obj (coloured points)", static_cast<int>(Copy::ObjPoints));
    m_copy->setItemData(m_copy->count() - 1, "One vertex per splat; opens in almost every 3D tool", Qt::ToolTipRole);
    m_copy->addItem("Wavefront .obj (coloured mesh)", static_cast<int>(Copy::ObjMesh));
    m_copy->setItemData(m_copy->count() - 1, "One small ellipsoid per splat; large for big scans", Qt::ToolTipRole);
    const int savedCopy = m_copy->findData(settings.value(kCopyKey, 0).toInt());
    m_copy->setCurrentIndex(savedCopy >= 0 ? savedCopy : 0);
    options->addRow("Also save", m_copy);

    auto* folderRow = new QHBoxLayout();
    m_copyFolder = new QLineEdit(settings.value(kCopyFolderKey, generation::DefaultOutputFolder()).toString(), this);
    m_browseCopyFolder = new QPushButton("Browse...", this);
    folderRow->addWidget(m_copyFolder, 1);
    folderRow->addWidget(m_browseCopyFolder);
    options->addRow("Save to", folderRow);
    layout->addLayout(options);

    auto* buttons = new QDialogButtonBox(QDialogButtonBox::Cancel, this);
    m_generate = buttons->addButton("Generate", QDialogButtonBox::AcceptRole);
    m_generate->setDefault(true);
    layout->addWidget(buttons);

    connect(m_removeBackground, &QCheckBox::toggled, this, [this] { updateControls(); }); // may need Python
    connect(m_source, &QComboBox::currentIndexChanged, this, [this] { onSourceChanged(); });
    connect(m_addFiles, &QPushButton::clicked, this, [this] { addFiles(); });
    connect(m_addFolder, &QPushButton::clicked, this, [this] { addFolder(); });
    connect(m_remove, &QPushButton::clicked, this, [this] { removeSelected(); });
    connect(m_clear, &QPushButton::clicked, this, [this] { m_files->clear(); updateControls(); });
    connect(m_files, &QListWidget::itemSelectionChanged, this, [this] { updateControls(); });
    connect(m_copyFolder, &QLineEdit::textChanged, this, [this] { updateControls(); });
    connect(m_browseCopyFolder, &QPushButton::clicked, this, [this] { browseCopyFolder(); });
    connect(buttons, &QDialogButtonBox::accepted, this, &QDialog::accept);
    connect(buttons, &QDialogButtonBox::rejected, this, &QDialog::reject);

    onSourceChanged();
}

bool GenerateModelDialog::isMedia() const {
    return m_source->currentIndex() == 1;
}

void GenerateModelDialog::onSourceChanged() {
    // Files of the other kind can't go in this build, so drop them.
    for (int i = m_files->count() - 1; i >= 0; --i) {
        if (!FitsSource(isMedia(), m_files->item(i)->data(Qt::UserRole).toString())) {
            delete m_files->takeItem(i);
        }
    }
    m_addFolder->setVisible(!isMedia());
    m_fps->setVisible(isMedia());
    m_fpsLabel->setVisible(isMedia());
    updateControls();
}

void GenerateModelDialog::addFiles() {
    QSettings settings;
    const QString folder = settings.value(kLastFolderKey,
                                          QStandardPaths::writableLocation(QStandardPaths::PicturesLocation)).toString();
    const QStringList paths = QFileDialog::getOpenFileNames(this, isMedia() ? "Add Videos" : "Add Photos", folder,
                                                            NameFilter(isMedia()));
    if (paths.isEmpty()) return;
    settings.setValue(kLastFolderKey, QFileInfo(paths.front()).absolutePath());
    addPaths(paths);
}

void GenerateModelDialog::addFolder() {
    QSettings settings;
    const QString folder = QFileDialog::getExistingDirectory(
        this, "Add Every Photo in a Folder",
        settings.value(kLastFolderKey, QStandardPaths::writableLocation(QStandardPaths::PicturesLocation)).toString());
    if (folder.isEmpty()) return;
    settings.setValue(kLastFolderKey, folder);

    const QStringList paths = generation::PhotosInFolder(folder);
    // A capture folder's name usually describes the object, so it names the model if nothing else has.
    if (m_name->text().isEmpty() && !paths.isEmpty()) {
        m_name->setText(QFileInfo(folder).fileName().left(kMaxNameLength));
    }
    addPaths(paths);
}

void GenerateModelDialog::addPaths(const QStringList& paths) {
    QSet<QString> existing;
    for (int i = 0; i < m_files->count(); ++i) existing.insert(m_files->item(i)->data(Qt::UserRole).toString());

    for (const QString& path : paths) {
        const QFileInfo info(path);
        const QString absolute = info.absoluteFilePath();
        if (!info.isFile() || existing.contains(absolute) || !FitsSource(isMedia(), path)) continue;
        existing.insert(absolute);
        auto* item = new QListWidgetItem(info.fileName(), m_files);
        item->setData(Qt::UserRole, absolute);
        item->setToolTip(QDir::toNativeSeparators(absolute));
    }
    // A video's file name usually describes the object, so it names the model if nothing else has.
    if (m_name->text().isEmpty() && !paths.isEmpty() && isMedia()) {
        m_name->setText(QFileInfo(paths.front()).completeBaseName().left(kMaxNameLength));
    }
    updateControls();
}

void GenerateModelDialog::removeSelected() {
    qDeleteAll(m_files->selectedItems());
    updateControls();
}

void GenerateModelDialog::browseCopyFolder() {
    const QString folder = QFileDialog::getExistingDirectory(this, "Save Models To", m_copyFolder->text());
    if (!folder.isEmpty()) m_copyFolder->setText(QDir::toNativeSeparators(folder));
}

void GenerateModelDialog::updateControls() {
    const int count = m_files->count();
    const bool media = isMedia();

    // Can this PC build it? Checked live, since background removal and videos also need Python.
    const QString toolProblem = LocalReconstruction::MissingTools(request(), m_tools);
    m_toolsHint->setText(toolProblem.isEmpty()
        ? QString("This PC (no server needed). COLMAP and Brush found; building takes minutes and uses the "
                  "GPU. The .ply is saved in the Save to folder.")
        : toolProblem);
    m_toolsHint->setStyleSheet(toolProblem.isEmpty() ? QString() : QString("color: #e6b450;"));

    // Anything in `problem` stops the build.
    // Too few or too many files first: the same check as the command-line build.
    QString problem = generation::FileCountProblem(media, count);
    if (problem.isEmpty()) {
        if (m_copyFolder->text().trimmed().isEmpty()) problem = "Choose where to save the model.";
        else if (!toolProblem.isEmpty()) problem = "This PC is missing tools (see above).";
    }

    if (!problem.isEmpty()) {
        m_fileCount->setText(problem);
        m_fileCount->setStyleSheet("color: #e6b450;");
    } else {
        m_fileCount->setText(QString("%1 %2").arg(count).arg(media ? (count == 1 ? "video" : "videos") : "photos"));
        m_fileCount->setStyleSheet(QString());
    }
    m_generate->setEnabled(problem.isEmpty());
    m_remove->setEnabled(!m_files->selectedItems().isEmpty());
    m_clear->setEnabled(count > 0);
}

GenerationRequest GenerateModelDialog::request() const {
    GenerationRequest request;
    request.source = isMedia() ? GenerationRequest::Source::Media : GenerationRequest::Source::Photos;
    for (int i = 0; i < m_files->count(); ++i) request.files << m_files->item(i)->data(Qt::UserRole).toString();
    request.name = m_name->text().trimmed();
    request.removeBackground = m_removeBackground->isChecked();
    request.autoCrop = m_autoCrop->isChecked();
    const int preset = m_detail->currentData().toInt();
    request.trainIters = preset == kCustomDetail ? m_customIters->value() : preset;
    request.fps = isMedia() ? m_fps->value() : 0.0;
    return request;
}

GenerationFollowUp GenerateModelDialog::followUp() const {
    GenerationFollowUp followUp;
    followUp.importIntoScene = m_import->isChecked();
    followUp.copy = static_cast<GenerationFollowUp::Copy>(m_copy->currentData().toInt());
    followUp.copyFolder = QDir::fromNativeSeparators(m_copyFolder->text().trimmed());
    return followUp;
}

void GenerateModelDialog::accept() {
    QSettings settings;
    settings.setValue(kSourceKey, m_source->currentIndex());
    settings.setValue(kDetailKey, m_detail->currentIndex());
    settings.setValue(kCustomItersKey, m_customIters->value());
    settings.setValue(kFpsKey, m_fps->value());
    settings.setValue(kRemoveBackgroundKey, m_removeBackground->isChecked());
    settings.setValue(kAutoCropKey, m_autoCrop->isChecked());
    settings.setValue(kImportKey, m_import->isChecked());
    settings.setValue(kCopyKey, m_copy->currentData().toInt());
    settings.setValue(kCopyFolderKey, m_copyFolder->text().trimmed());
    QDialog::accept();
}
