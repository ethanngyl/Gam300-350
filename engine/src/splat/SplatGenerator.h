/******************************************************************************
 * File:        SplatGenerator.h
 * Project:     Genesis
 * Author(s):	Clement Ang Yang Ying   (Primary, 100%) - Created functions
 *
 * Description:
 * This file contains the declaration for procedural splat generators, used to
 * stress test the engine (loading, selecting, moving, deleting) with large splat counts.
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#pragma once

#include "SplatData.h"

#include <cstddef>
#include <vector>

#include <glm/glm.hpp>

namespace splat_generate {

constexpr size_t kStressTestSplatCount = 1000000;

//Generates `count` splats evenly distributed over the surface of a sphere (Fibonacci lattice)
//Splat size is derived from the point spacing so the surface reads as solid.
//Color is the surface normal remapped to 0..1, so orientation is visible when the sphere is moved/rotated.
std::vector<SplatVertex> GenerateSphereSplats(size_t count = kStressTestSplatCount, float radius = 1.0f, const glm::vec3& center = glm::vec3(0.0f));

} // namespace splat_generate
