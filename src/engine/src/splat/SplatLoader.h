#pragma once

#include "SplatData.h"

#include <string>
#include <vector>

// Loads a Gaussian-splat .ply (see the shared field spec) using happly.
// Returns an empty vector and logs to stderr on any failure -- callers
// should treat "no splats" as a valid, non-fatal state (e.g. a missing
// sample asset shouldn't crash the engine).
std::vector<SplatVertex> LoadSplatPly(const std::string& path);
