/*!************************************************************************
\file PhotoEdits.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 20-10-2026
\brief
Photo processing for the Photo Editor. An "edits" object holds brightness,
contrast and sharpen (slider values) plus a crop given as fractions cut
from each side. renderEditedCanvas() applies them to a photo (optionally
downscaled, for the live preview); exportEditedFile() does the same at
full size for upload, and returns the original file untouched when there
are no edits so it keeps its camera details (EXIF).
**************************************************************************/

export const NO_CROP = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });

export const DEFAULT_EDITS = Object.freeze({
    brightness: 0, // -50 to 50
    contrast: 0, // -50 to 50
    sharpen: 0, // 0 to 100
    crop: NO_CROP, // fraction cut from each side
});

// Most that can be cut from one side, so at least 10% of the photo always
// remains and the object can't be cropped away entirely.
export const MAX_CROP_INSET = 0.45;

// Unsharp-mask strength at sharpen = 100. Kept low on purpose: strong
// sharpening adds halos and noise that confuse feature matching.
const SHARPEN_STRENGTH_AT_MAX = 1;

const CROP_EDGES = ['left', 'top', 'right', 'bottom'];
// Crops this close are treated as the same (dragging is never exact).
const CROP_MATCH_TOLERANCE = 0.005;

export function hasCrop(crop) {
    return CROP_EDGES.some((edge) => crop[edge] > 0);
}

export function hasEdits(edits) {
    return edits.brightness !== 0 || edits.contrast !== 0 || edits.sharpen !== 0 || hasCrop(edits.crop);
}

export function cropsMatch(firstCrop, secondCrop) {
    return CROP_EDGES.every((edge) => Math.abs(firstCrop[edge] - secondCrop[edge]) < CROP_MATCH_TOLERANCE);
}

// Same 256-value mapping for every colour channel, matching CSS
// brightness() then contrast(). Uint8ClampedArray clamps and rounds.
function buildToneMapping(brightness, contrast) {
    const brightnessFactor = 1 + brightness / 100;
    const contrastFactor = 1 + contrast / 100;
    const toneMapping = new Uint8ClampedArray(256);
    for (let value = 0; value < 256; value++) {
        toneMapping[value] = (value * brightnessFactor - 127.5) * contrastFactor + 127.5;
    }
    return toneMapping;
}

// Unsharp mask: push each pixel away from the average of its 3x3
// neighbourhood. The average is built in two passes (rows, then columns)
// so large photos stay reasonably fast.
function sharpenPixels(pixelBytes, width, height, strength) {
    const originalBytes = pixelBytes.slice();
    const rowSums = new Uint16Array(width * height * 3);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const leftX = x > 0 ? x - 1 : x;
            const rightX = x < width - 1 ? x + 1 : x;
            for (let channel = 0; channel < 3; channel++) {
                rowSums[(y * width + x) * 3 + channel] =
                    originalBytes[(y * width + leftX) * 4 + channel] +
                    originalBytes[(y * width + x) * 4 + channel] +
                    originalBytes[(y * width + rightX) * 4 + channel];
            }
        }
    }

    for (let y = 0; y < height; y++) {
        const aboveY = y > 0 ? y - 1 : y;
        const belowY = y < height - 1 ? y + 1 : y;
        for (let x = 0; x < width; x++) {
            for (let channel = 0; channel < 3; channel++) {
                const neighbourhoodAverage = (
                    rowSums[(aboveY * width + x) * 3 + channel] +
                    rowSums[(y * width + x) * 3 + channel] +
                    rowSums[(belowY * width + x) * 3 + channel]
                ) / 9;
                const byteIndex = (y * width + x) * 4 + channel;
                const originalValue = originalBytes[byteIndex];
                pixelBytes[byteIndex] = originalValue + strength * (originalValue - neighbourhoodAverage);
            }
        }
    }
}

// Draws the photo with its edits applied. maxLongestSide downscales the
// result (used for the preview); leave it out for full size.
export async function renderEditedCanvas(file, edits, maxLongestSide = Infinity) {
    const bitmap = await createImageBitmap(file);
    try {
        const { crop } = edits;
        const sourceX = Math.round(bitmap.width * crop.left);
        const sourceY = Math.round(bitmap.height * crop.top);
        const sourceWidth = Math.max(1, Math.round(bitmap.width * (1 - crop.left - crop.right)));
        const sourceHeight = Math.max(1, Math.round(bitmap.height * (1 - crop.top - crop.bottom)));

        const scale = Math.min(1, maxLongestSide / Math.max(sourceWidth, sourceHeight));
        const outputWidth = Math.max(1, Math.round(sourceWidth * scale));
        const outputHeight = Math.max(1, Math.round(sourceHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);

        const needsToneChange = edits.brightness !== 0 || edits.contrast !== 0;
        const needsSharpen = edits.sharpen > 0;

        if (needsToneChange || needsSharpen) {
            const imageData = context.getImageData(0, 0, outputWidth, outputHeight);
            const pixelBytes = imageData.data;

            if (needsToneChange) {
                const toneMapping = buildToneMapping(edits.brightness, edits.contrast);
                for (let byteIndex = 0; byteIndex < pixelBytes.length; byteIndex += 4) {
                    pixelBytes[byteIndex] = toneMapping[pixelBytes[byteIndex]];
                    pixelBytes[byteIndex + 1] = toneMapping[pixelBytes[byteIndex + 1]];
                    pixelBytes[byteIndex + 2] = toneMapping[pixelBytes[byteIndex + 2]];
                }
            }
            if (needsSharpen) {
                sharpenPixels(pixelBytes, outputWidth, outputHeight, (edits.sharpen / 100) * SHARPEN_STRENGTH_AT_MAX);
            }

            context.putImageData(imageData, 0, 0);
        }

        return canvas;
    } finally {
        bitmap.close?.();
    }
}

// Full-size version for upload. Untouched photos are returned as-is so
// they keep their camera details; anything the browser can't decode is
// also returned as-is rather than failing the whole upload.
export async function exportEditedFile(file, edits) {
    if (!hasEdits(edits)) return file;

    try {
        const canvas = await renderEditedCanvas(file, edits);
        const editedBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        if (!editedBlob) return file;

        const baseName = file.name.replace(/\.[^.]+$/, '');
        return new File([editedBlob], `${baseName}-edited.jpg`, { type: 'image/jpeg' });
    } catch {
        return file;
    }
}