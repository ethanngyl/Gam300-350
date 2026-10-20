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

//One byte per input splat, 1 = keep, 0 = trim
std::vector<uint8_t> ComputeKeepMask(const std::vector<SplatVertex>& splats, const SplatTrimmerParam& params);

//Copies only the splats whose mask entry is 1. Mask of the wrong size returns unchanged.
std::vector<SplatVertex> ApplyKeepMask(const std::vector<SplatVertex>& splats, const std::vector<uint8_t>& keep);

//Sensible trim settings for a scan, with the density cell size derived from the scene extent
SplatTrimmerParam MakeDefaultTrimmerParams(const std::vector<SplatVertex>& splats);

//Convenience trims with the default settings
std::vector<SplatVertex> TrimSplats(const std::vector<SplatVertex>& splats);