// Central place for every UI sound in the app. To add a new sound
// later, import the file here, add one line to SOUND_SOURCES, then
// use playSound('yourName') or withSound('yourName', handler)
// anywhere in the app
import buttonClick from './ButtonClick_2.wav';
// import success from './Success.wav';
// import error from './Error.wav';

const SOUND_SOURCES = {
    click: buttonClick,
    // success: success,
    // error: error,
};

const DEFAULT_VOLUME = 0.5;

// Preload every sound once, at module load time and reuse the same
// audio objects everywhere
const cache = {};
for (const [name, src] of Object.entries(SOUND_SOURCES)) {
    const audio = new Audio(src);
    audio.volume = DEFAULT_VOLUME;
    cache[name] = audio;
}

// Plays a registered sound by name. Resets playback position first so
// rapid repeated clicks restart the sound instead of doing nothing
export function playSound(name) {
    const audio = cache[name];
    if (!audio) {
        console.warn(`No sound registered for "${name}"`);
        return;
    }
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