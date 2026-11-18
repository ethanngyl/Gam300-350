/*!************************************************************************
\file ButtonSounds.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 06-11-2026
\brief
Implements ButtonSounds: watches mouse presses application-wide and, when
the left button is pressed on an enabled QPushButton or QToolButton, plays
"UI Hover New 1.wav" through FMOD. A timer pumps FMOD so finished voices are
freed.
**************************************************************************/
#include "ui/ButtonSounds.h"

#include "Manager/AudioManager.h"
#include "ui/AssetPaths.h"

#include <QApplication>
#include <QEvent>
#include <QFileInfo>
#include <QMouseEvent>
#include <QPushButton>
#include <QTimer>
#include <QToolButton>

namespace {
    // Click sound, relative to the assets/audio folder.
    const char* const kClickFile = "UI Hover New 1.wav";

    // How often FMOD is pumped (matches the Audio panel).
    constexpr int kAudioUpdateMs = 50;
}

ButtonSounds::ButtonSounds(QObject* parent)
    : QObject(parent)
    , m_audio(std::make_unique<AudioManager>()) {
    if (!m_audio->IsValid()) {
        qWarning("Button sounds disabled: %s", m_audio->LastError().c_str());
        return;
    }

    m_clickPath = AssetPaths::AssetsSubdir("audio") + "/" + kClickFile;
    if (!QFileInfo::exists(m_clickPath)) {
        qWarning("Button sounds disabled: missing %s", qPrintable(m_clickPath));
        m_clickPath.clear();
        return;
    }

    qApp->installEventFilter(this);

    auto* timer = new QTimer(this);
    timer->setInterval(kAudioUpdateMs);
    connect(timer, &QTimer::timeout, this, [this] { m_audio->Update(); });
    timer->start();
}

// Out-of-line so unique_ptr<AudioManager> sees the complete type here.
ButtonSounds::~ButtonSounds() = default;

bool ButtonSounds::eventFilter(QObject* watched, QEvent* event) {
    if (event->type() == QEvent::MouseButtonPress &&
        static_cast<QMouseEvent*>(event)->button() == Qt::LeftButton) {
        auto* widget = qobject_cast<QWidget*>(watched);
        const bool isButton = qobject_cast<QPushButton*>(watched) || qobject_cast<QToolButton*>(watched);
        // Disabled buttons never receive mouse presses, but check anyway.
        if (isButton && widget->isEnabled()) {
            if (!m_audio->Play(m_clickPath.toStdString())) {
                qWarning("Button sound: %s", m_audio->LastError().c_str());
            }
        }
    }
    return QObject::eventFilter(watched, event); // never swallow the event
}
