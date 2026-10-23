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

//User-facing trim settings. These are scale independent, so they suit any scan;
//ToTrimmerParam converts them to world units for a particular set of splats.
struct SplatTrimSettings
{
    float minAlpha = 0.005f;      //Drop splats with alpha below this (0 = off)
    float cropPct = 0.05f;        //Percent trimmed from each end of every axis (0 = off)
    int voxelDivisions = 100;     //Density cells across the scene's diagonal (0 = off)
    int minPerVoxel = 3;          //Drop splats whose cell holds fewer than this
};

//Converts the settings to world-unit parameters using the extent of the given splats
SplatTrimmerParam ToTrimmerParam(const SplatTrimSettings& settings, const std::vector<SplatVertex>& splats);

//One byte per input splat, 1 = keep, 0 = trim
std::vector<uint8_t> ComputeKeepMask(const std::vector<SplatVertex>& splats, const SplatTrimmerParam& params);

//Copies only the splats whose mask entry is 1. Mask of the wrong size returns unchanged.
std::vector<SplatVertex> ApplyKeepMask(const std::vector<SplatVertex>& splats, const std::vector<uint8_t>& keep);

//Convenience: trims with the given settings
std::vector<SplatVertex> TrimSplats(const std::vector<SplatVertex>& splats, const SplatTrimSettings& settings);