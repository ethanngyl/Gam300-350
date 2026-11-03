/******************************************************************************
 * File:        CropBox.cpp
 * Project:     Genesis
 *
 * Description:
 * Defines the crop box helpers declared in CropBox.h.
 ******************************************************************************/
#include "CropBox.h"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>

#include <cmath>

std::vector<uint8_t> ComputeCropKeepMask(const std::vector<SplatVertex>& splats, const glm::mat4& modelTransform, const CropBox& box)
{
    std::vector<uint8_t> keep(splats.size(), 1);

    //A flat box can't be inverted
    if (std::abs(glm::determinant(box.transform)) < 1e-12f)
        return keep;

    //Model space -> box space, so each splat only needs one multiply and a compare with the unit cube
    const glm::mat4 toBox = glm::inverse(box.transform) * modelTransform;
    const uint8_t insideValue = box.removeInside ? 0 : 1;
    const uint8_t outsideValue = box.removeInside ? 1 : 0;

    for (size_t i = 0; i < splats.size(); ++i)
    {
        const glm::vec3 p = glm::vec3(toBox * glm::vec4(splats[i].position, 1.0f));
        const bool inside = std::abs(p.x) <= 0.5f && std::abs(p.y) <= 0.5f && std::abs(p.z) <= 0.5f;
        keep[i] = inside ? insideValue : outsideValue;
    }
    return keep;
}

glm::mat4 FitCropBoxToSplats(const std::vector<SplatVertex>& splats, const glm::mat4& modelTransform)
{
    if (splats.empty())
        return glm::mat4(1.0f);

    glm::vec3 lo(INFINITY);
    glm::vec3 hi(-INFINITY);
    for (const SplatVertex& s : splats)
    {
        const glm::vec3 p = glm::vec3(modelTransform * glm::vec4(s.position, 1.0f));
        lo = glm::min(lo, p);
        hi = glm::max(hi, p);
    }

    //Keep every axis from collapsing to nothing, e.g. a perfectly flat scan
    const glm::vec3 size = glm::max((hi - lo) * 0.5f, glm::vec3(0.01f));
    return glm::translate(glm::mat4(1.0f), (lo + hi) * 0.5f) * glm::scale(glm::mat4(1.0f), size);
}

std::vector<uint32_t> CollectSplatsInBox(const std::vector<SplatVertex>& splats, const glm::mat4& modelTransform, const glm::mat4& boxTransform)
{
    std::vector<uint32_t> inside;
    if (std::abs(glm::determinant(boxTransform)) < 1e-12f)
        return inside;

    const glm::mat4 toBox = glm::inverse(boxTransform) * modelTransform;
    for (size_t i = 0; i < splats.size(); ++i)
    {
        const glm::vec3 p = glm::vec3(toBox * glm::vec4(splats[i].position, 1.0f));
        if (std::abs(p.x) <= 0.5f && std::abs(p.y) <= 0.5f && std::abs(p.z) <= 0.5f)
            inside.push_back(static_cast<uint32_t>(i));
    }
    return inside;
}

glm::mat4 WorldDeltaToModelSpace(const glm::mat4& deltaWorld, const glm::mat4& modelTransform)
{
    return glm::inverse(modelTransform) * deltaWorld * modelTransform;
}

SplatVertex TransformSplat(const SplatVertex& splat, const glm::mat4& deltaModel)
{
    SplatVertex out = splat;
    out.position = glm::vec3(deltaModel * glm::vec4(splat.position, 1.0f));

    //Split the linear part into per-axis scale factors and a pure rotation
    const glm::vec3 col0(deltaModel[0]);
    const glm::vec3 col1(deltaModel[1]);
    const glm::vec3 col2(deltaModel[2]);
    const float sx = glm::length(col0);
    const float sy = glm::length(col1);
    const float sz = glm::length(col2);
    if (sx < 1e-8f || sy < 1e-8f || sz < 1e-8f)
        return out; //Squashed flat, leave the orientation and size alone

    const glm::quat delta = glm::quat_cast(glm::mat3(col0 / sx, col1 / sy, col2 / sz));
    const glm::quat current(splat.rotation.x, splat.rotation.y, splat.rotation.z, splat.rotation.w); //Stored as (w, x, y, z)
    const glm::quat combined = glm::normalize(delta * current);
    out.rotation = glm::vec4(combined.w, combined.x, combined.y, combined.z);

    const float factor = std::cbrt(sx * sy * sz);
    out.scale = splat.scale * factor;
    out.pointSize = splat.pointSize * factor;
    return out;
}
