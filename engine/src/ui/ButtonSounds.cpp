/*!************************************************************************
\file ButtonSounds.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 06-11-2026
\brief
Implements ButtonSounds: watches every widget's Enter event application-wide
and, when it is an enabled QPushButton or QToolButton, plays
"UI Hover New 1.wav" through FMOD. A timer pumps FMOD so finished voices are
freed.
**************************************************************************/
#include "ui/ButtonSounds.h"

#include "Manager/AudioManager.h"
#include "ui/AssetPaths.h"

#include <QApplication>
#include <QEvent>
#include <QFileInfo>
#include <QPushButton>
#include <QTimer>
#include <QToolButton>

namespace {
    // Hover sound, relative to the assets/audio folder.
    const char* const kHoverFile = "UI Hover New 1.wav";

    // How often FMOD is pumped (matches the Audio panel).
    constexpr int kAudioUpdateMs = 50;

    // Minimum gap between hover sounds, so sweeping across a row of toolbar
    // buttons doesn't stack a burst of overlapping clicks.
    constexpr qint64 kMinGapMs = 40;
}

ButtonSounds::ButtonSounds(QObject* parent)
    : QObject(parent)
    , m_audio(std::make_unique<AudioManager>()) {
    if (!m_audio->IsValid()) {
        qWarning("Button sounds disabled: %s", m_audio->LastError().c_str());
        return;
    }

    m_hoverPath = AssetPaths::AssetsSubdir("audio") + "/" + kHoverFile;
    if (!QFileInfo::exists(m_hoverPath)) {
        qWarning("Button sounds disabled: missing %s", qPrintable(m_hoverPath));
        m_hoverPath.clear();
        return;
    }

    m_sinceLastPlay.start();
    qApp->installEventFilter(this);

    auto* timer = new QTimer(this);
    timer->setInterval(kAudioUpdateMs);
    connect(timer, &QTimer::timeout, this, [this] { m_audio->Update(); });
    timer->start();
}

// Out-of-line so unique_ptr<AudioManager> sees the complete type here.
ButtonSounds::~ButtonSounds() = default;

bool ButtonSounds::eventFilter(QObject* watched, QEvent* event) {
    if (event->type() == QEvent::Enter) {
        auto* widget = qobject_cast<QWidget*>(watched);
        const bool isButton = qobject_cast<QPushButton*>(watched) || qobject_cast<QToolButton*>(watched);
        if (isButton && widget->isEnabled() && m_sinceLastPlay.elapsed() >= kMinGapMs) {
            if (!m_audio->Play(m_hoverPath.toStdString())) {
                qWarning("Button sound: %s", m_audio->LastError().c_str());
            }
            m_sinceLastPlay.restart();
        }
    }
    return QObject::eventFilter(watched, event); // never swallow the event
}
