/******************************************************************************
 * File:        SplatLoader.h
 * Project:     Genesis
 * Author(s):	Ethan Ng Yong Le   (Primary, 100%)
 *
 * Description:
 * This file contains the declaration for the function LoadSplatPly, which loads a .ply file
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#pragma once

#include "SplatData.h"

#include <string>
#include <vector>

// Loads a Gaussian-splat .ply (see the shared field spec) using happly.
// Returns an empty vector and logs to stderr on any failure -- callers
// should treat "no splats" as a valid, non-fatal state (e.g. a missing
// sample asset shouldn't crash the engine).
std::vector<SplatVertex> LoadSplatPly(const std::string& path);
