/******************************************************************************
 * File:        SplatGenerator.cpp
 * Project:     Genesis
 * Author(s):	Clement Ang Yang Ying   (Primary, 100%) - Created functions
 *
 * Description:
 * This file contains the definition for procedural splat generators.
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#include "SplatGenerator.h"

#include <cmath>

namespace splat_generate {

std::vector<SplatVertex> GenerateSphereSplats(size_t count, float radius, const glm::vec3& center)
{
    std::vector<SplatVertex> splats;
    if (count == 0 || radius <= 0.0f) return splats;
    splats.reserve(count);

    constexpr float kPi = 3.14159265358979323846f;
    const float goldenAngle = kPi * (3.0f - std::sqrt(5.0f));

    //Average spacing between neighbouring points on the surface; splats are sized to just overlap
    const float spacing = std::sqrt(4.0f * kPi * radius * radius / static_cast<float>(count));
    const float splatScale = spacing * 0.5f;

    for (size_t i = 0; i < count; ++i) {
        //y runs from +1 to -1; ring radius follows from the unit sphere
        const float y = 1.0f - 2.0f * (static_cast<float>(i) + 0.5f) / static_cast<float>(count);
        const float ring = std::sqrt(std::fmax(0.0f, 1.0f - y * y));
        const float theta = goldenAngle * static_cast<float>(i);
        const glm::vec3 normal(ring * std::cos(theta), y, ring * std::sin(theta));

        SplatVertex v{};
        v.position = center + normal * radius;
        v.pointSize = splatScale;
        v.color = glm::vec3(0,0,0);
        v.alpha = 1.0f;
        v.modelID = 0.0f;
        v.scale = glm::vec3(splatScale);
        v.rotation = glm::vec4(1.0f, 0.0f, 0.0f, 0.0f); //identity (w, x, y, z)
        splats.push_back(v);
    }
    return splats;
}

} // namespace splat_generate
