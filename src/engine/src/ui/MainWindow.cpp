#include "ui/Viewport.h"
#include "ui/MainWindow.h"

#include <QCheckBox>
#include <QDockWidget>
#include <QLabel>
#include <QVBoxLayout>

namespace {
    // Stats label refresh interval, so the FPS readout is legible.
    constexpr qint64 kStatsRefreshMs = 250;
}

MainWindow::MainWindow() {
    setWindowTitle("Codefine - Engine Foundation (M1)");
    resize(1280, 720);

    m_viewport = new Viewport(this);
    setCentralWidget(m_viewport);

    // Qt dock panel, showing Qt widgets and the ImGui overlay driving each other.
    auto* panel = new QWidget(this);
    auto* layout = new QVBoxLayout(panel);
    m_statsLabel = new QLabel("Waiting for first frame...", panel);
    auto* imguiStatsToggle = new QCheckBox("Show ImGui \"Engine Stats\" window", panel);
    imguiStatsToggle->setChecked(true);
    layout->addWidget(m_statsLabel);
    layout->addWidget(imguiStatsToggle);
    layout->addStretch();

    auto* dock = new QDockWidget("Engine (Qt)", this);
    dock->setWidget(panel);
    addDockWidget(Qt::RightDockWidgetArea, dock);

    connect(imguiStatsToggle, &QCheckBox::toggled, this, [this](bool checked) {
        m_viewport->setShowImGuiStats(checked);
    });

    m_statsTimer.start();
    m_viewport->onStats = [this](float fps, std::size_t splatCount) {
        if (m_statsTimer.elapsed() < kStatsRefreshMs) {
            return;
        }
        m_statsTimer.restart();
        m_statsLabel->setText(QString("FPS: %1\nSplats loaded: %2")
                                  .arg(fps, 0, 'f', 1)
                                  .arg(static_cast<qulonglong>(splatCount)));
    };

    m_viewport->setFocus();
}
