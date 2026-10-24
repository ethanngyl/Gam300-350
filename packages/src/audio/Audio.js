/*!************************************************************************
\file Audio.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 01-10-2026
\brief
Central registry for the app's UI sound effects. Preloads each sound
once at module load and exposes playSound(name) and withSound(name,
handler) so any component can trigger a named sound by key instead of
managing its own Audio objects.
Also owns the sound settings (muted, volume 0-1), saved in this browser's
localStorage: setSoundMuted / setSoundVolume change them, and
useSoundSettings() gives components the current values and re-renders
them on any change, so the Account page and the account menu stay in step.
**************************************************************************/

import { useSyncExternalStore } from 'react';
import tapSound from './Tap.wav';
import confirmSound from './Confirm.wav';
import backSound from './Back.wav';
// import success from './Success.wav';
// import error from './Error.wav';
// import cameraSound from './Camera.wav';

const SOUND_SOURCES = {
    tap: tapSound,
    confirm: confirmSound,
    back: backSound,
    // success: success,
    // error: error,
};

const DEFAULT_VOLUME = 1.0;
const SETTINGS_STORAGE_KEY = 'genesis-sound-settings';

// Reads the saved settings once at load. Storage can be blocked (private
// windows, site data off), so every access is wrapped.
function loadSoundSettings() {
    try {
        const saved = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY));
        return {
            isMuted: saved?.isMuted === true,
            volume: typeof saved?.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : DEFAULT_VOLUME,
        };
    } catch {
        return { isMuted: false, volume: DEFAULT_VOLUME };
    }
}

// Replaced (never edited) on every change, so React can tell it changed.
let soundSettings = loadSoundSettings();
const settingsListeners = new Set();

function updateSoundSettings(changes) {
    soundSettings = { ...soundSettings, ...changes };
    try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(soundSettings));
    } catch {
        // Storage unavailable: the setting lasts until the page reloads.
    }
    settingsListeners.forEach((listener) => listener());
}

export function setSoundMuted(isMuted) {
    updateSoundSettings({ isMuted });
}

// volume: 0 (silent) to 1 (full)
export function setSoundVolume(volume) {
    updateSoundSettings({ volume: Math.min(1, Math.max(0, volume)) });
}

function subscribeToSoundSettings(listener) {
    settingsListeners.add(listener);
    return () => settingsListeners.delete(listener);
}

function getSoundSettings() {
    return soundSettings;
}

// React hook: { isMuted, volume }, re-rendering whenever either changes.
export function useSoundSettings() {
    return useSyncExternalStore(subscribeToSoundSettings, getSoundSettings);
}

// Preload every sound once, at module load time and reuse the same
// audio objects everywhere
const cache = {};
for (const [name, src] of Object.entries(SOUND_SOURCES)) {
    cache[name] = new Audio(src);
}

// Plays a registered sound by name at the current volume, unless muted.
// Resets playback position first so rapid repeated clicks restart the
// sound instead of doing nothing
export function playSound(name) {
    const audio = cache[name];
    if (!audio) {
        console.warn(`No sound registered for "${name}"`);
        return;
    }
    if (soundSettings.isMuted || soundSettings.volume === 0) return;
    audio.volume = soundSettings.volume;
    audio.currentTime = 0;
    audio.play().catch(() => {
    });
}

export function withSound(name, handler) {
    return (...args) => {
        playSound(name);
        if (handler) handler(...args);
    };
}