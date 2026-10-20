/*!************************************************************************
\file PhotoChecks.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-10-2026
\brief
Browser-side checks and edits for the Photo Editor. analyzePhoto() measures
sharpness (variance of the Laplacian), average brightness and a small
difference hash for spotting near-duplicates, all on a downscaled copy so
it stays fast. findPhotoIssues() turns those numbers into per-photo flags.
applyAdjustments() bakes batch brightness/contrast into a new JPEG using
the same maths as the CSS filter used for the live preview.
**************************************************************************/

import { measureClippedShare } from './PhotoEdits.js';

// Longest side, in pixels, of the downscaled copy used for the checks.
const ANALYSIS_LONGEST_SIDE = 256;
// The difference hash compares 9x8 pixels to get 64 bits.
const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

// A photo counts as blurry when its sharpness is below this fraction of the
// batch median. Relative rather than absolute, because raw sharpness depends
// heavily on the camera and the subject.
const BLUR_RATIO_OF_MEDIAN = 0.4;
// With fewer photos than this, the median isn't meaningful, so skip the check.
const MIN_PHOTOS_FOR_BLUR_CHECK = 3;
// Average brightness (0-255) outside this range is flagged.
const TOO_DARK_BELOW = 45;
const TOO_BRIGHT_ABOVE = 215;
// Most bits (out of 64) two consecutive photos may differ by and still count
// as near-duplicates. Kept low on purpose: turntable shots are meant to look
// similar, and a looser value would flag most of the batch.
const DUPLICATE_MAX_DIFFERENT_BITS = 2;

export const ISSUE_LABELS = {
    blurry: 'Blurry',
    duplicate: 'Near-duplicate',
    dark: 'Too dark',
    bright: 'Too bright',
};

export const ISSUE_EXPLANATIONS = {
    blurry: 'Much less sharp than the rest of your photos. Blurry photos make it harder to match details between shots.',
    duplicate: 'Almost the same as the photo before it, so it adds little new information.',
    dark: 'Very dark overall, so details may be lost in the shadows.',
    bright: 'Very bright overall, so details may be washed out.',
};

function toGrayscale(rgbaData, pixelCount) {
    const gray = new Float32Array(pixelCount);
    for (let pixelIndex = 0, byteIndex = 0; pixelIndex < pixelCount; pixelIndex++, byteIndex += 4) {
        gray[pixelIndex] =
            0.299 * rgbaData[byteIndex] +
            0.587 * rgbaData[byteIndex + 1] +
            0.114 * rgbaData[byteIndex + 2];
    }
    return gray;
}

function drawToGrayscale(bitmap, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, width, height);
    return toGrayscale(context.getImageData(0, 0, width, height).data, width * height);
}

// Variance of the Laplacian: sharp photos have strong edges, so the
// Laplacian varies a lot; blurry photos give a low variance.
function measureSharpness(gray, width, height) {
    let sum = 0;
    let sumOfSquares = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const index = y * width + x;
            const laplacian =
                gray[index - width] + gray[index + width] +
                gray[index - 1] + gray[index + 1] -
                4 * gray[index];
            sum += laplacian;
            sumOfSquares += laplacian * laplacian;
            count++;
        }
    }

    if (count === 0) return 0;
    const mean = sum / count;
    return sumOfSquares / count - mean * mean;
}

function averageOf(values) {
    let total = 0;
    for (let index = 0; index < values.length; index++) total += values[index];
    return values.length > 0 ? total / values.length : 0;
}

// Difference hash: one bit per pixel pair, set when a pixel is brighter than
// its right-hand neighbour. Similar photos give nearly identical bits.
function differenceHashBits(gray) {
    const bits = new Uint8Array((HASH_WIDTH - 1) * HASH_HEIGHT);
    let bitIndex = 0;
    for (let y = 0; y < HASH_HEIGHT; y++) {
        for (let x = 0; x < HASH_WIDTH - 1; x++) {
            const index = y * HASH_WIDTH + x;
            bits[bitIndex++] = gray[index] > gray[index + 1] ? 1 : 0;
        }
    }
    return bits;
}

function countDifferentBits(firstBits, secondBits) {
    let differentCount = 0;
    for (let index = 0; index < firstBits.length; index++) {
        if (firstBits[index] !== secondBits[index]) differentCount++;
    }
    return differentCount;
}

// Draws the photo at the given size and returns its raw RGBA bytes.
function drawToPixelBytes(bitmap, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
}

// Colour and tone measurements used by auto fix, auto colour and the
// "lost detail" warning.
function measureColorStats(pixelBytes, gray, width, height) {
    const pixelCount = width * height;

    let redTotal = 0;
    let greenTotal = 0;
    let blueTotal = 0;
    for (let byteIndex = 0; byteIndex < pixelBytes.length; byteIndex += 4) {
        redTotal += pixelBytes[byteIndex];
        greenTotal += pixelBytes[byteIndex + 1];
        blueTotal += pixelBytes[byteIndex + 2];
    }

    const meanBrightness = averageOf(gray);
    let squaredDifferenceTotal = 0;
    for (let index = 0; index < gray.length; index++) {
        const difference = gray[index] - meanBrightness;
        squaredDifferenceTotal += difference * difference;
    }

    // Middle 60% of the photo, where the object usually is.
    const centerLeft = Math.floor(width * 0.2);
    const centerRight = Math.ceil(width * 0.8);
    const centerTop = Math.floor(height * 0.2);
    const centerBottom = Math.ceil(height * 0.8);
    let centerTotal = 0;
    let centerCount = 0;
    for (let y = centerTop; y < centerBottom; y++) {
        for (let x = centerLeft; x < centerRight; x++) {
            centerTotal += gray[y * width + x];
            centerCount++;
        }
    }

    return {
        averageRed: redTotal / pixelCount,
        averageGreen: greenTotal / pixelCount,
        averageBlue: blueTotal / pixelCount,
        centerBrightness: centerCount > 0 ? centerTotal / centerCount : meanBrightness,
        tonalSpread: Math.sqrt(squaredDifferenceTotal / pixelCount),
        clippedShare: measureClippedShare(pixelBytes),
    };
}

// Measures one photo. Throws if the browser can't decode it (for example
// HEIC outside Safari); the caller treats that as "couldn't check".
export async function analyzePhoto(file) {
    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, ANALYSIS_LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(3, Math.round(bitmap.width * scale));
        const height = Math.max(3, Math.round(bitmap.height * scale));

        const pixelBytes = drawToPixelBytes(bitmap, width, height);
        const gray = toGrayscale(pixelBytes, width * height);
        const hashGray = drawToGrayscale(bitmap, HASH_WIDTH, HASH_HEIGHT);

        return {
            sharpness: measureSharpness(gray, width, height),
            brightness: averageOf(gray),
            hashBits: differenceHashBits(hashGray),
            ...measureColorStats(pixelBytes, gray, width, height),
        };
    } finally {
        bitmap.close?.();
    }
}

// Turns the measurements into flags. photos is the editor's list, in order:
// [{ id, analysisStatus: 'pending' | 'done' | 'failed', analysis }].
// Returns { [photoId]: ['blurry', 'dark', ...] }.
export function findPhotoIssues(photos) {
    const analyzedPhotos = photos.filter((photo) => photo.analysisStatus === 'done');
    const sortedSharpness = analyzedPhotos
        .map((photo) => photo.analysis.sharpness)
        .sort((first, second) => first - second);
    const medianSharpness = sortedSharpness.length > 0
        ? sortedSharpness[Math.floor(sortedSharpness.length / 2)]
        : 0;
    const canCheckBlur = analyzedPhotos.length >= MIN_PHOTOS_FOR_BLUR_CHECK && medianSharpness > 0;

    const issuesById = {};
    let previousAnalysis = null;

    for (const photo of photos) {
        const issues = [];

        if (photo.analysisStatus === 'done') {
            const { sharpness, brightness, hashBits } = photo.analysis;

            if (canCheckBlur && sharpness < medianSharpness * BLUR_RATIO_OF_MEDIAN) {
                issues.push('blurry');
            }
            if (brightness < TOO_DARK_BELOW) {
                issues.push('dark');
            } else if (brightness > TOO_BRIGHT_ABOVE) {
                issues.push('bright');
            }
            if (previousAnalysis &&
                countDifferentBits(hashBits, previousAnalysis.hashBits) <= DUPLICATE_MAX_DIFFERENT_BITS) {
                issues.push('duplicate');
            }

            previousAnalysis = photo.analysis;
        }

        issuesById[photo.id] = issues;
    }

    return issuesById;
}
