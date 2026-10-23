#include "SplatTrimmer.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <unordered_map>

namespace {
    struct VoxelKey {
        int64_t x, y, z;
        bool operator==(const VoxelKey& o) const { return x == o.x && y == o.y && z == o.z; }
    };

    //Hash map for pos
    //Hash values from online
    struct VoxelKeyHash {
        size_t operator()(const VoxelKey& k) const {
            uint64_t h = static_cast<uint64_t>(k.x) * 73856093ull;
            h ^= static_cast<uint64_t>(k.y) * 19349663ull;
            h ^= static_cast<uint64_t>(k.z) * 83492791ull;
            return static_cast<size_t>(h);
        }
    };

    //Checks if the the pos, size and alpha is a finite num
    bool IsFinite(const SplatVertex& s) {
        return std::isfinite(s.position.x) && std::isfinite(s.position.y) && std::isfinite(s.position.z) &&
               std::isfinite(s.pointSize) && std::isfinite(s.alpha);
    }

    //Value at the given percentile (0-100) of the positions of the kept splats on one axis
    float AxisPercentile(const std::vector<SplatVertex>& splats, const std::vector<uint8_t>& keep, int axis, float pct)
    {
        std::vector<float> values;
        values.reserve(splats.size());
        for (size_t i = 0; i < splats.size(); ++i) {
            if (keep[i]) values.push_back(splats[i].position[axis]);
        }
        if (values.empty()) return 0.0f;

        const float t = std::clamp(pct, 0.0f, 100.0f) / 100.0f;
        const size_t index = static_cast<size_t>(t * static_cast<float>(values.size() - 1) + 0.5f);
        std::nth_element(values.begin(), values.begin() + index, values.end());
        return values[index];
    }
}

std::vector<uint8_t> ComputeKeepMask(const std::vector<SplatVertex>& splats, const SplatTrimmerParam& params)
{
    std::vector<uint8_t> keep(splats.size(), 1);

    //Per-splat filters: invalid data, near-invisible, oversized
    for (size_t i = 0; i < splats.size(); ++i) {
        const SplatVertex& s = splats[i];
        if (!IsFinite(s)) { keep[i] = 0; continue; }
        if (params.minAlpha > 0.0f && s.alpha < params.minAlpha) keep[i] = 0;
        else if (params.maxSize > 0.0f && s.pointSize > params.maxSize) keep[i] = 0;
    }

    //Crop each axis to the central percentile range
    if (params.cropLowPct > 0.0f || params.cropHighPct < 100.0f) {
        float lo[3], hi[3];
        for (int axis = 0; axis < 3; ++axis) {
            lo[axis] = AxisPercentile(splats, keep, axis, params.cropLowPct);
            hi[axis] = AxisPercentile(splats, keep, axis, params.cropHighPct);
        }
        for (size_t i = 0; i < splats.size(); ++i) {
            if (!keep[i]) continue;
            for (int axis = 0; axis < 3; ++axis) {
                const float p = splats[i].position[axis];
                if (p < lo[axis] || p > hi[axis]) { keep[i] = 0; break; }
            }
        }
    }

    //Density filter: drop splats isolated in sparsely populated voxels (floaters)
    if (params.voxelSize > 0.0f && params.minPerVoxel > 1) {
        const float inv = 1.0f / params.voxelSize;
        auto keyOf = [inv](const glm::vec3& p) {
            return VoxelKey{ static_cast<int64_t>(std::floor(p.x * inv)),
                             static_cast<int64_t>(std::floor(p.y * inv)),
                             static_cast<int64_t>(std::floor(p.z * inv)) };
        };

        std::unordered_map<VoxelKey, int, VoxelKeyHash> counts;
        counts.reserve(splats.size() / 4 + 1);
        for (size_t i = 0; i < splats.size(); ++i) {
            if (keep[i]) ++counts[keyOf(splats[i].position)];
        }
        for (size_t i = 0; i < splats.size(); ++i) {
            if (keep[i] && counts[keyOf(splats[i].position)] < params.minPerVoxel) keep[i] = 0;
        }
    }

    return keep;
}

std::vector<SplatVertex> ApplyKeepMask(const std::vector<SplatVertex>& splats, const std::vector<uint8_t>& keep)
{
    std::vector<SplatVertex> result;
    if (keep.size() != splats.size()) return splats;

    result.reserve(splats.size());
    for (size_t i = 0; i < splats.size(); ++i) {
        if (keep[i]) result.push_back(splats[i]);
    }
    return result;
}

SplatTrimmerParam ToTrimmerParam(const SplatTrimSettings& settings, const std::vector<SplatVertex>& splats)
{
    SplatTrimmerParam params;
    params.minAlpha = settings.minAlpha;
    params.cropLowPct = settings.cropPct;
    params.cropHighPct = 100.0f - settings.cropPct;
    params.minPerVoxel = settings.minPerVoxel;

    //Size the density cells from the extent of the cropped scene so it works at any scale
    if (settings.voxelDivisions > 0 && !splats.empty()) {
        std::vector<uint8_t> all(splats.size(), 1);
        glm::vec3 lo, hi;
        for (int axis = 0; axis < 3; ++axis) {
            lo[axis] = AxisPercentile(splats, all, axis, params.cropLowPct);
            hi[axis] = AxisPercentile(splats, all, axis, params.cropHighPct);
        }
        const float diagonal = glm::length(hi - lo);
        if (std::isfinite(diagonal) && diagonal > 0.0f) {
            params.voxelSize = diagonal / static_cast<float>(settings.voxelDivisions);
        }
    }
    return params;
}

std::vector<SplatVertex> TrimSplats(const std::vector<SplatVertex>& splats, const SplatTrimSettings& settings)
{
    return ApplyKeepMask(splats, ComputeKeepMask(splats, ToTrimmerParam(settings, splats)));
}
