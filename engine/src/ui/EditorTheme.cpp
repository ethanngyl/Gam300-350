/*!************************************************************************
\file EditorTheme.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Implements the dark editor theme: Fusion style, a dark palette that matches
the viewport's ImGui overlay, and a stylesheet for the editor chrome.
**************************************************************************/
#include "ui/EditorTheme.h"

#include <QApplication>
#include <QColor>
#include <QPalette>
#include <QStyleFactory>

namespace {
    // Base colours, darkest to lightest, plus one accent. The stylesheet
    // below uses the same values, so keep them in sync.
    const QColor kWindow(0x2b, 0x2b, 0x2e);    // panels, menus
    const QColor kBase(0x1e, 0x1e, 0x21);      // list/edit backgrounds
    const QColor kAltBase(0x25, 0x25, 0x28);   // alternating rows
    const QColor kButton(0x35, 0x35, 0x39);
    const QColor kText(0xdc, 0xdc, 0xdc);
    const QColor kDisabledText(0x7a, 0x7a, 0x7f);
    const QColor kAccent(0x3d, 0x8e, 0xe6);    // selection / highlight

    const char* kStyleSheet = R"(
QMainWindow::separator { background: #1a1a1c; width: 4px; height: 4px; }
QMainWindow::separator:hover { background: #3d8ee6; }

QDockWidget::title {
    background: #232326; padding: 5px 8px; border-bottom: 1px solid #1a1a1c;
}
QTabBar::tab {
    background: #232326; color: #a8a8ad; padding: 5px 12px;
    border: 1px solid #1a1a1c; border-bottom: none;
}
QTabBar::tab:selected { background: #2b2b2e; color: #dcdcdc; border-top: 2px solid #3d8ee6; }
QTabBar::tab:hover:!selected { color: #dcdcdc; }

QToolBar { background: #2b2b2e; border-bottom: 1px solid #1a1a1c; spacing: 4px; padding: 3px; }
QToolButton { padding: 4px 8px; border: 1px solid transparent; border-radius: 3px; }
QToolButton:hover { background: #3a3a3f; border-color: #46464c; }
QToolButton:checked { background: #2c4f78; border-color: #3d8ee6; }

QStatusBar { background: #232326; border-top: 1px solid #1a1a1c; }
QStatusBar QLabel { padding: 0 8px; color: #a8a8ad; }

QTreeView, QListView, QPlainTextEdit { border: 1px solid #1a1a1c; }
QHeaderView::section { background: #2b2b2e; padding: 4px 6px; border: none; border-right: 1px solid #1a1a1c; }

QLabel#PanelHint, QLabel#EmptyState { color: #8a8a90; }
QLabel#SectionHeader { color: #a8a8ad; font-weight: bold; padding-top: 6px; }
)";
}

namespace EditorTheme {

void Apply(QApplication& app) {
    // Fusion renders the same everywhere and respects the palette fully,
    // unlike the native Windows style.
    app.setStyle(QStyleFactory::create("Fusion"));

    QPalette palette;
    palette.setColor(QPalette::Window, kWindow);
    palette.setColor(QPalette::WindowText, kText);
    palette.setColor(QPalette::Base, kBase);
    palette.setColor(QPalette::AlternateBase, kAltBase);
    palette.setColor(QPalette::ToolTipBase, kBase);
    palette.setColor(QPalette::ToolTipText, kText);
    palette.setColor(QPalette::PlaceholderText, kDisabledText);
    palette.setColor(QPalette::Text, kText);
    palette.setColor(QPalette::Button, kButton);
    palette.setColor(QPalette::ButtonText, kText);
    palette.setColor(QPalette::BrightText, Qt::red);
    palette.setColor(QPalette::Link, kAccent);
    palette.setColor(QPalette::Highlight, kAccent);
    palette.setColor(QPalette::HighlightedText, Qt::white);
    palette.setColor(QPalette::Light, kButton.lighter(130));
    palette.setColor(QPalette::Midlight, kButton.lighter(115));
    palette.setColor(QPalette::Mid, kWindow.darker(120));
    palette.setColor(QPalette::Dark, kBase.darker(120));
    palette.setColor(QPalette::Shadow, Qt::black);

    for (QPalette::ColorRole role : { QPalette::WindowText, QPalette::Text,
                                      QPalette::ButtonText, QPalette::HighlightedText }) {
        palette.setColor(QPalette::Disabled, role, kDisabledText);
    }
    palette.setColor(QPalette::Disabled, QPalette::Highlight, kButton);

    app.setPalette(palette);
    app.setStyleSheet(kStyleSheet);
}

} // namespace EditorTheme
