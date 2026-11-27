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
exactly like a photo picked from the device. smallPhotoUrl() gives the
address of a photo's small copy, for cards and grids.
**************************************************************************/

/************************************************************************/
/*!
  \brief
    The small copy of a stored photo (a WebP about 480 px across, GET
    .../images/<name>?size=small), for showing it in a card or grid. Full
    photos are 12 MP, and loading one per card made the Library stutter.
    Downloads and photos added to a batch still use the original URL.
  \param url
    A photo URL from GET /jobs (images[].url), or null
  \return
    The small copy's URL, or null
*/
/************************************************************************/
export function smallPhotoUrl(url) {
    if (!url) return null;
    return `${url}${url.includes('?') ? '&' : '?'}size=small`;
}

const IMAGE_TYPES_BY_EXTENSION = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
};

export async function fetchLibraryBatches() {
    const res = await fetch('/api/v1/jobs');
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