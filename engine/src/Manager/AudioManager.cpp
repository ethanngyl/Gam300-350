/*!************************************************************************
\file AudioManager.cpp
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 02-10-2026
\brief
Implements AudioManager: creates and initialises the FMOD Core system in the
constructor, caches sounds by path, plays each on its own channel so they can
overlap, stops all voices on demand, and releases everything in the
destructor. Each FMOD call is checked and, on failure, recorded in m_lastError
so the UI can surface it instead of silently doing nothing.
**************************************************************************/
#include "Manager/AudioManager.h"

#include <fmod.hpp>
#include <fmod_errors.h>

namespace {
    // Max simultaneous software channels; comfortably more than the UI needs.
    constexpr int kMaxChannels = 64;
}

AudioManager::AudioManager() {
    FMOD_RESULT result = FMOD::System_Create(&m_system);
    if (result != FMOD_OK) {
        m_lastError = std::string("FMOD System_Create failed: ") + FMOD_ErrorString(result);
        m_system = nullptr;
        return;
    }

    result = m_system->init(kMaxChannels, FMOD_INIT_NORMAL, nullptr);
    if (result != FMOD_OK) {
        m_lastError = std::string("FMOD init failed: ") + FMOD_ErrorString(result);
        m_system->release();
        m_system = nullptr;
        return;
    }
}

AudioManager::~AudioManager() {
    StopAll();
    for (auto& [path, sound] : m_sounds) {
        if (sound) {
            sound->release();
        }
    }
    m_sounds.clear();
    if (m_system) {
        m_system->close();
        m_system->release();
        m_system = nullptr;
    }
}

FMOD::Sound* AudioManager::GetOrLoad(const std::string& path) {
    if (auto it = m_sounds.find(path); it != m_sounds.end()) {
        return it->second;
    }

    FMOD::Sound* sound = nullptr;
    FMOD_RESULT result = m_system->createSound(path.c_str(), FMOD_DEFAULT, nullptr, &sound);
    if (result != FMOD_OK) {
        m_lastError = std::string("Could not load \"") + path + "\": " + FMOD_ErrorString(result);
        return nullptr;
    }

    m_sounds.emplace(path, sound);
    return sound;
}

bool AudioManager::Play(const std::string& path) {
    if (!m_system) {
        m_lastError = "Audio system is not initialised.";
        return false;
    }

    FMOD::Sound* sound = GetOrLoad(path);
    if (!sound) {
        return false; // LastError already set
    }

    FMOD::Channel* channel = nullptr;
    FMOD_RESULT result = m_system->playSound(sound, nullptr, false, &channel);
    if (result != FMOD_OK) {
        m_lastError = std::string("Could not play \"") + path + "\": " + FMOD_ErrorString(result);
        return false;
    }

    m_channels.push_back(channel);
    m_lastError.clear();
    return true;
}

void AudioManager::StopAll() {
    for (FMOD::Channel* channel : m_channels) {
        if (channel) {
            channel->stop();
        }
    }
    m_channels.clear();
}

std::size_t AudioManager::PlayingCount() const {
    std::size_t count = 0;
    for (FMOD::Channel* channel : m_channels) {
        bool playing = false;
        // A finished/stolen channel returns an error here; count only live ones.
        if (channel && channel->isPlaying(&playing) == FMOD_OK && playing) {
            ++count;
        }
    }
    return count;
}

void AudioManager::Update() {
    if (!m_system) {
        return;
    }
    m_system->update();

    // Drop handles for voices that have finished or been stolen, so the active
    // list does not grow without bound as sounds are played.
    for (std::size_t i = 0; i < m_channels.size();) {
        FMOD::Channel* channel = m_channels[i];
        bool playing = false;
        if (!channel || channel->isPlaying(&playing) != FMOD_OK || !playing) {
            m_channels[i] = m_channels.back();
            m_channels.pop_back();
        } else {
            ++i;
        }
    }
}
