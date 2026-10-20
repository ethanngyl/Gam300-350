/*!************************************************************************
\file PhotoEdits.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 20-10-2026
\brief
Photo processing for the Photo Editor. An "edits" object holds brightness,
contrast, warmth, tint and sharpen (slider values) plus a crop given as
fractions cut from each side.
- buildChannelTransfer() turns the colour edits into one straight-line
  formula per colour channel. Both the canvas export and the SVG filters
  used for thumbnails are built from it, so previews match the upload.
- renderEditedCanvas() / exportEditedFile() apply all edits to a photo.
  Untouched photos are uploaded as-is so they keep their camera details.
- computeAutoFix() and computeWhiteBalance() work out automatic
  corrections; sampleColor() reads a spot of the unedited photo for the
  "pick neutral spot" tool; measureClippedShare() feeds the warnings.
**************************************************************************/

export const NO_CROP = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });

export const DEFAULT_EDITS = Object.freeze({
    brightness: 0, // -50 to 50
    contrast: 0, // -50 to 50
    warmth: 0, // -50 (cooler, bluer) to 50 (warmer, yellower)
    tint: 0, // -50 (greener) to 50 (pinker)
    sharpen: 0, // 0 to 100
    crop: NO_CROP, // fraction cut from each side
});

// Most that can be cut from one side, so at least 10% of the photo always
// remains and the object can't be cropped away entirely.
export const MAX_CROP_INSET = 0.45;

// Unsharp-mask strength at sharpen = 100. Kept low on purpose: strong
// sharpening adds halos and noise that confuse feature matching.
const SHARPEN_STRENGTH_AT_MAX = 1;

// Auto fix aims the middle of the photos at this brightness (0-255), and
// only adds contrast when the tones are flatter than the target spread.
const AUTO_FIX_TARGET_BRIGHTNESS = 125;
const AUTO_FIX_TARGET_SPREAD = 50;
// Largest change auto fix will make to brightness or contrast.
const AUTO_FIX_MAX_CHANGE = 25;

// White balance limits, and the range of colours that are safe to balance
// against (too dark is noisy, near white is clipped and has no colour left).
const WHITE_BALANCE_LIMIT = 50;
const NEUTRAL_SAMPLE_MIN = 15;
const NEUTRAL_SAMPLE_MAX = 250;

// A pixel counts as clipped when all three channels are at least this
// bright, or at most CLIPPED_LOW dark.
const CLIPPED_HIGH = 250;
const CLIPPED_LOW = 5;

const CROP_EDGES = ['left', 'top', 'right', 'bottom'];
// Crops this close are treated as the same (dragging is never exact).
const CROP_MATCH_TOLERANCE = 0.005;

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function averageOf(values) {
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

export function hasCrop(crop) {
    return CROP_EDGES.some((edge) => crop[edge] > 0);
}

export function hasColorChange(edits) {
    return edits.brightness !== 0 || edits.contrast !== 0 || edits.warmth !== 0 || edits.tint !== 0;
}

export function hasEdits(edits) {
    return hasColorChange(edits) || edits.sharpen !== 0 || hasCrop(edits.crop);
}

export function cropsMatch(firstCrop, secondCrop) {
    return CROP_EDGES.every((edge) => Math.abs(firstCrop[edge] - secondCrop[edge]) < CROP_MATCH_TOLERANCE);
}

// Warmth trades red against blue; tint moves green against the other two.
function channelGains(edits) {
    return {
        red: 1 + edits.warmth / 200,
        green: 1 - edits.tint / 200,
        blue: 1 - edits.warmth / 200,
    };
}

// Every colour edit is a straight line per channel, on values from 0 to 1:
//   output = slope * input + intercept
// (white balance gain, then brightness, then contrast around the middle).
export function buildChannelTransfer(edits) {
    const gains = channelGains(edits);
    const brightnessFactor = 1 + edits.brightness / 100;
    const contrastFactor = 1 + edits.contrast / 100;
    const intercept = 0.5 - 0.5 * contrastFactor;

    return {
        red: { slope: gains.red * brightnessFactor * contrastFactor, intercept },
        green: { slope: gains.green * brightnessFactor * contrastFactor, intercept },
        blue: { slope: gains.blue * brightnessFactor * contrastFactor, intercept },
    };
}

// Lookup table from one channel's transfer, on 0-255 values.
// Uint8ClampedArray clamps and rounds for us.
function buildChannelMapping({ slope, intercept }) {
    const channelMapping = new Uint8ClampedArray(256);
    for (let value = 0; value < 256; value++) {
        channelMapping[value] = value * slope + intercept * 255;
    }
    return channelMapping;
}

// Share of pixels (0-1) that are pure white or pure black.
export function measureClippedShare(pixelBytes) {
    const pixelCount = pixelBytes.length / 4;
    if (pixelCount === 0) return 0;

    let clippedCount = 0;
    for (let byteIndex = 0; byteIndex < pixelBytes.length; byteIndex += 4) {
        const red = pixelBytes[byteIndex];
        const green = pixelBytes[byteIndex + 1];
        const blue = pixelBytes[byteIndex + 2];
        const isBlownOut = red >= CLIPPED_HIGH && green >= CLIPPED_HIGH && blue >= CLIPPED_HIGH;
        const isCrushed = red <= CLIPPED_LOW && green <= CLIPPED_LOW && blue <= CLIPPED_LOW;
        if (isBlownOut || isCrushed) clippedCount++;
    }
    return clippedCount / pixelCount;
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

        const needsColorChange = hasColorChange(edits);
        const needsSharpen = edits.sharpen > 0;

        if (needsColorChange || needsSharpen) {
            const imageData = context.getImageData(0, 0, outputWidth, outputHeight);
            const pixelBytes = imageData.data;

            if (needsColorChange) {
                const transfer = buildChannelTransfer(edits);
                const redMapping = buildChannelMapping(transfer.red);
                const greenMapping = buildChannelMapping(transfer.green);
                const blueMapping = buildChannelMapping(transfer.blue);
                for (let byteIndex = 0; byteIndex < pixelBytes.length; byteIndex += 4) {
                    pixelBytes[byteIndex] = redMapping[pixelBytes[byteIndex]];
                    pixelBytes[byteIndex + 1] = greenMapping[pixelBytes[byteIndex + 1]];
                    pixelBytes[byteIndex + 2] = blueMapping[pixelBytes[byteIndex + 2]];
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

// One brightness/contrast correction from photo measurements (see
// analyzePhoto). Uses the middle of each photo, where the object usually
// is, so a white or black backdrop doesn't throw it off as much.
export function computeAutoFix(analyses) {
    if (analyses.length === 0) return null;

    const averageCenterBrightness = averageOf(analyses.map((analysis) => analysis.centerBrightness));
    const averageTonalSpread = averageOf(analyses.map((analysis) => analysis.tonalSpread));

    let brightness = 0;
    if (averageCenterBrightness > 0) {
        brightness = Math.round((AUTO_FIX_TARGET_BRIGHTNESS / averageCenterBrightness - 1) * 100);
    }

    // Only ever adds contrast to flat-looking photos; never reduces it.
    let contrast = 0;
    if (averageTonalSpread > 0 && averageTonalSpread < AUTO_FIX_TARGET_SPREAD) {
        contrast = Math.round((AUTO_FIX_TARGET_SPREAD / averageTonalSpread - 1) * 100);
    }

    return {
        brightness: clamp(brightness, -AUTO_FIX_MAX_CHANGE, AUTO_FIX_MAX_CHANGE),
        contrast: clamp(contrast, 0, AUTO_FIX_MAX_CHANGE),
    };
}

// Warmth and tint that turn this average colour (0-255 per channel) into a
// neutral grey. Returns null when the colour is too dark or too close to
// pure white to be trusted.
export function computeWhiteBalance(red, green, blue) {
    const darkestChannel = Math.min(red, green, blue);
    const brightestChannel = Math.max(red, green, blue);
    if (darkestChannel < NEUTRAL_SAMPLE_MIN || brightestChannel >= NEUTRAL_SAMPLE_MAX) return null;

    // Warmth: red and blue gains must end up in the ratio blue : red.
    const blueToRedRatio = blue / red;
    const warmth = (200 * (blueToRedRatio - 1)) / (blueToRedRatio + 1);

    // Tint: green's gain relative to the average of the red and blue gains.
    const greenGainTarget = (1 / green) / ((1 / red + 1 / blue) / 2);
    const tint = 200 * (1 - greenGainTarget);

    return {
        warmth: Math.round(clamp(warmth, -WHITE_BALANCE_LIMIT, WHITE_BALANCE_LIMIT)),
        tint: Math.round(clamp(tint, -WHITE_BALANCE_LIMIT, WHITE_BALANCE_LIMIT)),
    };
}

// Average colour of a small spot of the unedited photo. fractionX and
// fractionY (0-1) are positions inside the given crop, matching where the
// user clicked on the preview.
export async function sampleColor(file, crop, fractionX, fractionY) {
    const canvas = await renderEditedCanvas(file, { ...DEFAULT_EDITS, crop }, 400);
    const centerX = Math.round(clamp(fractionX, 0, 1) * (canvas.width - 1));
    const centerY = Math.round(clamp(fractionY, 0, 1) * (canvas.height - 1));
    const sampleRadius = 3;

    const left = Math.max(0, centerX - sampleRadius);
    const top = Math.max(0, centerY - sampleRadius);
    const right = Math.min(canvas.width, centerX + sampleRadius + 1);
    const bottom = Math.min(canvas.height, centerY + sampleRadius + 1);

    const pixelBytes = canvas.getContext('2d').getImageData(left, top, right - left, bottom - top).data;
    let redTotal = 0;
    let greenTotal = 0;
    let blueTotal = 0;
    const pixelCount = pixelBytes.length / 4;

    for (let byteIndex = 0; byteIndex < pixelBytes.length; byteIndex += 4) {
        redTotal += pixelBytes[byteIndex];
        greenTotal += pixelBytes[byteIndex + 1];
        blueTotal += pixelBytes[byteIndex + 2];
    }

    return {
        red: redTotal / pixelCount,
        green: greenTotal / pixelCount,
        blue: blueTotal / pixelCount,
    };
}