/*!************************************************************************
\file ProfilePhoto.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 02-11-2026
\brief
The signed-in user's profile photo. The backend has no place to store it
yet, so it is kept in this browser's localStorage, one per email address,
as a small square JPEG (256 x 256, centre-cropped). useProfilePhoto(email)
gives components the current photo and re-renders them when it changes,
so the account page and the dock avatar stay in step.
- useProfilePhoto(email)
React hook: the photo as a data URL, or null if none is set.
- saveProfilePhoto(email, file)
Shrinks and crops the chosen image, then saves it. Resolves when done;
rejects if the file is not an image the browser can read.
- removeProfilePhoto(email)
Deletes the saved photo.
**************************************************************************/

import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY_PREFIX = 'genesis-profile-photo:';
const PHOTO_SIZE = 256;

const photoListeners = new Set();

function storageKey(email) {
    return `${STORAGE_KEY_PREFIX}${email}`;
}

// Storage can be blocked (private windows, site data off), so every access is wrapped.
function readPhoto(email) {
    try {
        return window.localStorage.getItem(storageKey(email));
    } catch {
        return null;
    }
}

function notifyPhotoListeners() {
    photoListeners.forEach((listener) => listener());
}

function subscribeToPhoto(listener) {
    photoListeners.add(listener);
    return () => photoListeners.delete(listener);
}

export function useProfilePhoto(email) {
    const getPhoto = useCallback(() => readPhoto(email), [email]);
    return useSyncExternalStore(subscribeToPhoto, getPhoto);
}

// Loads the file into an <img> so it can be drawn onto a canvas.
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('That file is not an image this browser can open.'));
        };
        image.src = objectUrl;
    });
}

export async function saveProfilePhoto(email, file) {
    const image = await loadImage(file);

    // Centre-crop to a square, then scale down to PHOTO_SIZE.
    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    const cropLeft = (image.naturalWidth - cropSize) / 2;
    const cropTop = (image.naturalHeight - cropSize) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    canvas.getContext('2d').drawImage(image, cropLeft, cropTop, cropSize, cropSize, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    const photoDataUrl = canvas.toDataURL('image/jpeg', 0.85);

    try {
        window.localStorage.setItem(storageKey(email), photoDataUrl);
    } catch {
        throw new Error('Could not save the photo in this browser (storage is full or blocked).');
    }
    notifyPhotoListeners();
}

export function removeProfilePhoto(email) {
    try {
        window.localStorage.removeItem(storageKey(email));
    } catch {
        // Storage unavailable: nothing was saved, so nothing to remove.
    }
    notifyPhotoListeners();
}