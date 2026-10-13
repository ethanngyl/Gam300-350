#pragma once

#include "SplatData.h"

#include <cstdint>
#include <vector>


struct SplatTrimmerParam
{
    float minAlpha = 0.0f;  //Drop splats with alpha below this (0 = off)
    float maxSize = 0.0f;   //Drop splats with pointSize above this (0 = off)
    float cropLowPct = 0.0f;//Keep the central range per axis; 0 and 100 = off
    float cropHighPct = 100.0f;
    float voxelSize = 0.0f; //Density filter cell size in world units (0 = off)
    int minPerVoxel = 5;    //Drop splats whose voxel holds fewer than this
};

//One byte per input splat: 1 = keep, 0 = trimmed
std::vector<uint8_t> ComputeKeepMask(const std::vector<SplatVertex>& splats, const SplatTrimmerParam& params);