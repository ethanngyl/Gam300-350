/*!************************************************************************
\file ThemePreference.js
\par Course: csd3401f26
\par Software Engineering Project 5
\date 10-11-2026
\brief
Light / dark appearance for the web app. The choice ('light', 'dark' or
'system') is remembered on this browser and applied as
<html data-theme="light|dark">, which AppTheme.css reads to pick its
colour set. index.html runs the same lookup inline before the first paint,
so the page never flashes the wrong theme; this module keeps it in step
afterwards (and follows the OS setting while 'system' is chosen).
- useThemePreference()
{ preference, resolvedTheme } for a component, updated on every change.
- setThemePreference(preference)
Saves and applies 'light', 'dark' or 'system'.
**************************************************************************/

import { useSyncExternalStore } from 'react';

// Same key and default as the inline script in index.html.
const STORAGE_KEY = 'genesis-theme';
const DEFAULT_PREFERENCE = 'light';
const PREFERENCES = ['light', 'dark', 'system'];
const DARK_QUERY = '(prefers-color-scheme: dark)';

const listeners = new Set();

// Storage can be blocked (private windows, site data off), so every access is wrapped.
function loadPreference() {
    try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        return PREFERENCES.includes(saved) ? saved : DEFAULT_PREFERENCE;
    } catch {
        return DEFAULT_PREFERENCE;
    }
}

let currentPreference = loadPreference();

function systemTheme() {
    return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

function resolve(preference) {
    return preference === 'system' ? systemTheme() : preference;
}

function apply() {
    document.documentElement.dataset.theme = resolve(currentPreference);
}

let snapshot = { preference: currentPreference, resolvedTheme: resolve(currentPreference) };

function notify() {
    apply();
    snapshot = { preference: currentPreference, resolvedTheme: resolve(currentPreference) };
    listeners.forEach((listener) => listener());
}

// Follow the OS while 'system' is chosen.
window.matchMedia?.(DARK_QUERY).addEventListener?.('change', () => {
    if (currentPreference === 'system') notify();
});

// Another tab changed it.
window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    currentPreference = loadPreference();
    notify();
});

apply();

export function setThemePreference(preference) {
    if (!PREFERENCES.includes(preference)) return;
    currentPreference = preference;
    try {
        window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
        // Storage unavailable: the choice lasts until the page is reloaded.
    }
    notify();
}

function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useThemePreference() {
    return useSyncExternalStore(subscribe, () => snapshot);
}
