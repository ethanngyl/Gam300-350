/*!************************************************************************
\file LibraryPhotos.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 20-10-2026
\brief
Reads the photo library for the library picker. fetchLibraryBatches()
lists past jobs that have photos (GET /jobs). downloadLibraryPhoto()
fetches one stored photo and turns it into a File, so it can join a batch
exactly like a photo picked from the device.
**************************************************************************/

const IMAGE_TYPES_BY_EXTENSION = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
};

export async function fetchLibraryBatches() {
    const res = await fetch('/jobs');
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const jobs = await res.json();
    return jobs.filter((job) => Array.isArray(job.images) && job.images.length > 0);
}

// The server may not send an image type, and the batch screens only accept
// files whose type starts with "image/", so fall back to the file extension.
function guessImageType(fileName, blobType) {
    if (blobType && blobType.startsWith('image/')) return blobType;
    const extension = fileName.split('.').pop()?.toLowerCase();
    return IMAGE_TYPES_BY_EXTENSION[extension] ?? 'image/jpeg';
}

export async function downloadLibraryPhoto(jobId, image) {
    const res = await fetch(image.url);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const blob = await res.blob();
    const fileName = `${jobId.slice(0, 8)}-${image.name}`;
    return new File([blob], fileName, { type: guessImageType(image.name, blob.type) });
}