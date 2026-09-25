#pragma once

#include <QElapsedTimer>
#include <QMainWindow>

class QLabel;
class Viewport;

// The single editor window: the 3D viewport (with its ImGui overlay) in the
// centre and Qt dock panels around it.
class MainWindow : public QMainWindow {
public:
    MainWindow();

private:
    Viewport* m_viewport = nullptr;   // owned by this window
    QLabel* m_statsLabel = nullptr;   // owned by the dock panel
    QElapsedTimer m_statsTimer;
};
