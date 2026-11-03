/******************************************************************************
 * File:        CropBox.h
 * Project:     Genesis
 *
 * Description:
 * Declares the crop box: an editor-only oriented box used to select a region of
 * splats so they can be removed. The box is a unit cube centred on the origin
 * ([-0.5, 0.5] on every axis) placed in the world by a single matrix, so it is
 * translated, rotated and scaled exactly like a SplatModel.
 ******************************************************************************/
#pragma once

#include "SplatData.h"

#include <glm/glm.hpp>

#include <cstdint>
#include <vector>

struct CropBox
{
    glm::mat4 transform = glm::mat4(1.0f); //World-space placement of the unit cube
    bool active = false;                   //Box is shown and the gizmo edits it
    bool removeInside = true;              //true removes splats inside, false removes everything outside
    bool moveContents = false;             //true makes gizmo drags carry the splats inside the box, false edits the box itself
};

//One byte per splat, 1 = keep, 0 = remove
//Splat positions are in model space, so modelTransform is needed to compare them with the worldspace box
//A box with 0 scale removes nothing
std::vector<uint8_t> ComputeCropKeepMask(const std::vector<SplatVertex>& splats, const glm::mat4& modelTransform, const CropBox& box);

//Worldspace transform of a box that fits roughly the middle half of the splats, used as the starting box
//Returns identity if there are no splats
glm::mat4 FitCropBoxToSplats(const std::vector<SplatVertex>& splats, const glm::mat4& modelTransform);
