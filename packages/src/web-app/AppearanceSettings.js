/*!************************************************************************
\file AppearanceSettings.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 13-11-2026
\brief
How the app looks, saved in this browser's localStorage:
- theme: 'dark', 'light' or 'system' (follows the device). The chosen
  colours are applied as data-theme="dark" | "light" on <html>; the light
  colours are in AppTheme.css. index.html applies the saved theme before
  the page first paints, so a light-theme user never sees a dark flash.
setTheme changes it, and useAppearanceSettings() gives components the
current value ({ theme }) and re-renders them when it changes.
**************************************************************************/

import { useSyncExternalStore } from 'react';

// index.html reads THEME_STORAGE_KEY too; keep the two in step.
const THEME_STORAGE_KEY = 'genesis-theme';
export const THEME_CHOICES = ['dark', 'light', 'system'];

const deviceLightQuery = window.matchMedia?.('(prefers-color-scheme: light)');

// Storage can be blocked (private windows, site data off), so every access is wrapped.
function readStorage(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // Storage unavailable: the setting lasts until the page reloads.
    }
}

function loadAppearanceSettings() {
    const savedTheme = readStorage(THEME_STORAGE_KEY);
    return {
        theme: THEME_CHOICES.includes(savedTheme) ? savedTheme : 'dark',
    };
}

// Replaced (never edited) on every change, so React can tell it changed.
let appearanceSettings = loadAppearanceSettings();
const settingsListeners = new Set();

// 'system' becomes dark or light from the device's setting.
function resolvedTheme() {
    if (appearanceSettings.theme !== 'system') return appearanceSettings.theme;
    return deviceLightQuery?.matches ? 'light' : 'dark';
}

function applyTheme() {
    document.documentElement.dataset.theme = resolvedTheme();
}

function updateAppearanceSettings(changes) {
    appearanceSettings = { ...appearanceSettings, ...changes };
    applyTheme();
    settingsListeners.forEach((listener) => listener());
}

export function setTheme(theme) {
    if (!THEME_CHOICES.includes(theme)) return;
    writeStorage(THEME_STORAGE_KEY, theme);
    updateAppearanceSettings({ theme });
}

function subscribeToAppearanceSettings(listener) {
    settingsListeners.add(listener);
    return () => settingsListeners.delete(listener);
}

function getAppearanceSettings() {
    return appearanceSettings;
}

// React hook: { theme }, re-rendering whenever it changes.
export function useAppearanceSettings() {
    return useSyncExternalStore(subscribeToAppearanceSettings, getAppearanceSettings);
}

// 'system': follow the device when it switches between light and dark.
deviceLightQuery?.addEventListener?.('change', () => {
    if (appearanceSettings.theme === 'system') applyTheme();
});

applyTheme();