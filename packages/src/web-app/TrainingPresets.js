/*!************************************************************************
\file TrainingPresets.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 27-10-2026
\brief
The model detail choices shown by TrainingQualitySlider. Each one is the
cap on how many training iterations Brush runs: fewer is faster but
blurrier, more is slower but sharper. The chosen number is sent to the
backend as trainIters (POST /upload and POST /jobs/from-youtube), which
clamps it to its own min / max.
**************************************************************************/

export const TRAINING_PRESETS = [
    { id: 'fast', label: 'Fast', iterations: 5000 },
    { id: 'normal', label: 'Normal', iterations: 7000 },
    { id: 'detailed', label: 'Detailed', iterations: 10000 },
];

// Matches the backend's default (config.trainIters).
export const DEFAULT_TRAINING_ITERATIONS = 7000;