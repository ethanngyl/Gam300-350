/*!************************************************************************
\file EditorTheme.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Declares ApplyEditorTheme, which gives the whole application the dark
editor look: the Fusion style (identical on every platform), a dark
QPalette, and a small stylesheet for the dock, toolbar and status bar chrome.
**************************************************************************/
#pragma once

class QApplication;

namespace EditorTheme {
    // Call once, right after the QApplication is created and before any
    // window is built, so every widget picks up the palette.
    void Apply(QApplication& app);
}
