/*!************************************************************************
\file MainWindow.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 01-10-2026
\brief
Declares MainWindow, the QMainWindow that is the single editor window: it
hosts the 3D Viewport (with its ImGui overlay) in the centre and the Qt
dock panels (the stats label and the ImGui "Engine Stats" toggle) around it.
**************************************************************************/
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
