/******************************************************************************
 * File:        CropBox.cpp
 * Project:     Genesis
 *
 * Description:
 * Defines the crop box helpers declared in CropBox.h.
 ******************************************************************************/
#include "CropBox.h"

#include <glm/gtc/matrix_transform.hpp>

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
