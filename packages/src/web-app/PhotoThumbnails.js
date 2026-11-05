/*!************************************************************************
\file PhotoThumbnails.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Small thumbnails for the photo grids on the capture page and in the Photo
Editor. Showing the original photos there made the page lag with large
batches: a 12 MP photo takes about 48 MB once the browser decodes it, so
it kept throwing decoded photos away and decoding them again while
scrolling. Each photo now gets one small copy (THUMBNAIL_WIDTH wide) for
the grid; the original file is still what is checked, edited and uploaded.
- makeThumbnailUrl(file)
Makes one thumbnail and returns its object URL. Rejects if the browser
can't read the file (for example HEIC outside Safari).
- usePhotoThumbnails(photos)
React hook: { [photoId]: url } for a list of { id, file }, made one at a
time in list order (null if a photo couldn't be read; missing while not
made yet). Releases the thumbnails of removed photos, and all of them when
the page closes.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';

// Wide enough to stay sharp in the largest grid tile on a high-DPI screen.
const THUMBNAIL_WIDTH = 480;

export async function makeThumbnailUrl(file) {
    // Shrinks while decoding and keeps the photo's orientation.
    const bitmap = await createImageBitmap(file, { resizeWidth: THUMBNAIL_WIDTH, resizeQuality: 'medium' });
    try {
        // Browsers that ignore the resize option still get a small copy here.
        const scale = Math.min(1, THUMBNAIL_WIDTH / bitmap.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        // WebP keeps any transparency (browsers without a WebP encoder give a PNG instead).
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Could not make a thumbnail.'))), 'image/webp', 0.8);
        });
        return URL.createObjectURL(blob);
    } finally {
        bitmap.close?.();
    }
}

export function usePhotoThumbnails(photos) {
    const [urlsById, setUrlsById] = useState({});
    // The photo whose thumbnail is being made, so only one is made at a time.
    const makingPhotoIdRef = useRef(null);
    // Ids of the photos still in the list (empty once the page closes), so a
    // thumbnail finished after its photo was removed is released straight away.
    const liveIdsRef = useRef(new Set());
    // Latest thumbnails, for releasing them when the page closes.
    const urlsRef = useRef(urlsById);

    useEffect(() => {
        urlsRef.current = urlsById;
    }, [urlsById]);

    // Release the thumbnails of photos that were removed.
    useEffect(() => {
        const liveIds = new Set(photos.map((photo) => photo.id));
        liveIdsRef.current = liveIds;
        Object.entries(urlsRef.current).forEach(([photoId, url]) => {
            if (url && !liveIds.has(photoId)) URL.revokeObjectURL(url);
        });
    }, [photos]);

    // Make the next missing thumbnail. Each finished one updates the map,
    // which re-runs this effect and starts the next.
    useEffect(() => {
        if (makingPhotoIdRef.current) return;
        const nextPhoto = photos.find((photo) => !(photo.id in urlsById));
        if (!nextPhoto) return;

        makingPhotoIdRef.current = nextPhoto.id;
        makeThumbnailUrl(nextPhoto.file)
            .catch(() => null)
            .then((url) => {
                makingPhotoIdRef.current = null;
                let keptUrl = url;
                if (keptUrl && !liveIdsRef.current.has(nextPhoto.id)) {
                    URL.revokeObjectURL(keptUrl);
                    keptUrl = null;
                }
                setUrlsById((currentUrls) => ({ ...currentUrls, [nextPhoto.id]: keptUrl }));
            });
    }, [photos, urlsById]);

    // Release every thumbnail when the page closes.
    useEffect(() => {
        return () => {
            liveIdsRef.current = new Set();
            Object.values(urlsRef.current).forEach((url) => {
                if (url) URL.revokeObjectURL(url);
            });
        };
    }, []);

    return urlsById;
}
