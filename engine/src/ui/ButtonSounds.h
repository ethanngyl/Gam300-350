/*!************************************************************************
\file ButtonSounds.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 06-11-2026
\brief
Declares ButtonSounds, an application-wide event filter that plays a short
UI sound whenever the mouse moves onto an enabled push or tool button
anywhere in the editor (main window, docks, toolbars and dialogs). It owns
its own FMOD AudioManager so it is independent of the Audio panel.
**************************************************************************/
#pragma once

#include <QElapsedTimer>
#include <QObject>
#include <QString>

#include <memory>

class AudioManager;

class ButtonSounds : public QObject {
    Q_OBJECT

public:
    // Installs itself as an event filter on the running QApplication.
    explicit ButtonSounds(QObject* parent = nullptr);
    ~ButtonSounds() override;

protected:
    bool eventFilter(QObject* watched, QEvent* event) override;

private:
    std::unique_ptr<AudioManager> m_audio; // FMOD wrapper for the hover sound
    QString m_hoverPath;                   // absolute path of the hover .wav
    QElapsedTimer m_sinceLastPlay;         // throttles rapid re-triggers
};
