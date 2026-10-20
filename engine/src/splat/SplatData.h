/******************************************************************************
 * File:        SplatData.h
 * Project:     Genesis
 * Author(s):	Ethan Ng Yong Le    (Primary, 80%) - Created definitions
 *              Clement Ang Yang Ying   (Secondary, 20%) - Updated SplatVertex and functions
 *
 * Description:
 * This file contains the definition and declaration for various 
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#pragma once

#include <glm/glm.hpp>

#include <cmath>

//Decoded, GPU-ready representation of a single Gaussian splat vertex.
//Source fields (per the team's .ply spec): x,y,z, scale_0..2 (log-encoded),
//rot_0..3, opacity (pre-sigmoid), f_dc_0..2, f_rest_0..44 (higher-order SH,
//unused at M1 since splats are rendered as flat, view-independent blobs).
struct SplatVertex {
    glm::vec3 position;
    float pointSize; //world-space splat radius, decoded from scale_0..2
    glm::vec3 color; //decoded from f_dc_0..2 (SH DC term)
    float alpha; //decoded from opacity
    float modelID;

    //Extra data for Gaussian splat mode. Point cloud mode only uses pointSize.
    glm::vec3 scale; //per-axis Gaussian std-dev (world units), decoded from scale_0..2
    glm::vec4 rotation; //normalized orientation quaternion stored as (w, x, y, z), from rot_0..3
};

namespace splat_decode {

constexpr float kShC0 = 0.28209479177387814f;

inline float decodeScale(float logScale) {
    return std::exp(logScale);
}

//rot_0..3 are stored as (w, x, y, z) but are not guaranteed to be unit length, so normalize before use. Zero quaternion uses identity matrix
inline glm::vec4 decodeRotation(float w, float x, float y, float z) {
    float len = std::sqrt(w * w + x * x + y * y + z * z);
    if (len < 1e-8f) return glm::vec4(1.0f, 0.0f, 0.0f, 0.0f);
    return glm::vec4(w, x, y, z) / len;
}

inline float decodeOpacity(float rawOpacity) {
    return 1.0f / (1.0f + std::exp(-rawOpacity));
}

inline glm::vec3 decodeColor(float fDc0, float fDc1, float fDc2) {
    return glm::vec3(
        0.5f + kShC0 * fDc0,
        0.5f + kShC0 * fDc1,
        0.5f + kShC0 * fDc2);
}

} // namespace splat_decode
