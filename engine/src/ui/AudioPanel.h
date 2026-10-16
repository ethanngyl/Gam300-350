/*!************************************************************************
\file AudioPanel.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 02-10-2026
\brief
Declares AudioPanel, the editor's "Audio" dock contents: it lists the audio
files in a chosen folder and plays them (several at once) through the FMOD
AudioManager it owns, which it also pumps on a timer.
**************************************************************************/
#pragma once

#include <QWidget>

#include <memory>

class QLabel;
class QListWidget;
class AudioManager;

class AudioPanel : public QWidget {
    Q_OBJECT

public:
    explicit AudioPanel(QWidget* parent = nullptr);
    ~AudioPanel() override;

    // Folder currently listed (persisted by the main window between runs).
    QString folder() const { return m_folder; }
    // Lists the audio files in dir. Empty dir falls back to the default folder.
    void setFolder(const QString& dir);

    // Stops every playing sound.
    void stopAll();

private:
    // Plays every file currently selected in the list (they layer together).
    void playSelected();
    void playPath(const QString& path, const QString& displayName);

    QListWidget* m_list = nullptr;
    QLabel* m_folderLabel = nullptr;  // which folder is listed
    QLabel* m_statusLabel = nullptr;  // last action / errors
    QLabel* m_voicesLabel = nullptr;  // live count of playing sounds

    std::unique_ptr<AudioManager> m_audio; // FMOD wrapper driving the buttons
    QString m_folder;                      // folder currently listed
};
