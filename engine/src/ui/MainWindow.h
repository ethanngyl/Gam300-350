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

#include <memory>

class QLabel;
class QListWidget;
class Viewport;
class AudioManager;

// The single editor window: the 3D viewport (with its ImGui overlay) in the
// centre and Qt dock panels around it.
class MainWindow : public QMainWindow {
public:
    MainWindow();
    ~MainWindow() override;

private:
    // Builds the "Audio" dock panel (folder list + play/stop controls) and
    // wires its widgets to m_audio.
    void buildAudioPanel();

    // Refills the folder list widget with the audio files found in dir.
    void populateAudioList(const QString& dir);

    // Plays every file currently selected in the list (they layer together).
    void playSelectedAudio();

    Viewport* m_viewport = nullptr;        // owned by this window
    QLabel* m_statsLabel = nullptr;        // owned by the dock panel
    QElapsedTimer m_statsTimer;

    // Audio dock panel widgets (owned by the panel/window).
    QListWidget* m_audioList = nullptr;
    QLabel* m_audioFolderLabel = nullptr;  // which folder is listed
    QLabel* m_audioStatusLabel = nullptr;  // last action / errors
    QLabel* m_voicesLabel = nullptr;       // live count of playing sounds

    std::unique_ptr<AudioManager> m_audio; // FMOD wrapper driving the buttons
    QString m_audioFolder;                 // folder currently listed
};
