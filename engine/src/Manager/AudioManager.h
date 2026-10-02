/*!************************************************************************
\file AudioManager.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 02-10-2026
\brief
Declares AudioManager, a thin wrapper over the FMOD Core API. It owns the
FMOD system, caches loaded sounds by path, and plays them on independent
channels so several files can overlap at once. Pump it once per frame via
Update(). The FMOD types are forward declared so this header stays free of
the FMOD includes.
**************************************************************************/
#pragma once

#include <cstddef>
#include <string>
#include <unordered_map>
#include <vector>

namespace FMOD {
    class System;
    class Sound;
    class Channel;
}

// Thin wrapper over FMOD Core: initialises the FMOD system and plays audio
// files, each on its own channel, so multiple sounds can play simultaneously.
// Construct one, check IsValid(), then Play()/StopAll() and call Update()
// regularly (e.g. from a timer) so FMOD can service itself and finished voices
// are reaped.
class AudioManager {
public:
    AudioManager();
    ~AudioManager();

    // Non-copyable: it owns raw FMOD handles.
    AudioManager(const AudioManager&) = delete;
    AudioManager& operator=(const AudioManager&) = delete;

    // True once the FMOD system initialised successfully.
    bool IsValid() const { return m_system != nullptr; }

    // Starts the given file on a new channel WITHOUT stopping sounds already
    // playing, so calls layer on top of each other. The sound is cached, so
    // replaying the same file does not reload it. Returns false and sets
    // LastError() on failure.
    bool Play(const std::string& path);

    // Stops every currently playing sound. Cached sounds stay loaded.
    void StopAll();

    // Number of sounds currently playing.
    std::size_t PlayingCount() const;

    // Pumps the FMOD system and drops finished voices. Call regularly; FMOD
    // needs this to progress streaming, fire callbacks and free channels.
    void Update();

    // Human-readable description of the last failure (empty if none).
    const std::string& LastError() const { return m_lastError; }

private:
    // Returns a cached sound for the path, loading (and caching) it on first
    // use. Returns nullptr and sets LastError() on failure.
    FMOD::Sound* GetOrLoad(const std::string& path);

    FMOD::System* m_system = nullptr;                        // owned FMOD system
    std::unordered_map<std::string, FMOD::Sound*> m_sounds;  // path -> cached sound (owned)
    std::vector<FMOD::Channel*> m_channels;                  // active voices (FMOD-owned)
    std::string m_lastError;
};
