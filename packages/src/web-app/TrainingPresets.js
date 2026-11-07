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
backend as trainIters (POST /upload and POST /jobs/from-media), which
clamps it to its own min / max. The presets and the default are reference
data in the backend's catalog/catalog.json, read through
GET /api/v1/catalog (catalog.js).
**************************************************************************/

import { catalog } from './catalog.js';

export const TRAINING_PRESETS = catalog.trainingPresets;

// The default preset's iterations (catalog.defaultTrainingPreset).
export const DEFAULT_TRAINING_ITERATIONS =
    TRAINING_PRESETS.find((preset) => preset.id === catalog.defaultTrainingPreset).iterations;