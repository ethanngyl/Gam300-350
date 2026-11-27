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

#include <cstddef>
#include <filesystem>
#include <string>
#include <vector>

// Loads a Gaussian-splat .ply (see the shared field spec) using happly.
// Returns an empty vector and logs to stderr on any failure -- callers
// should treat "no splats" as a valid, non-fatal state (e.g. a missing
// sample asset shouldn't crash the engine).
std::vector<SplatVertex> LoadSplatPly(const std::string& path);

// Same, from a std::filesystem::path. On Windows this opens the file by its
// wide (UTF-16) name, so folders with any characters work; a std::string path
// only reaches files whose names fit the system code page. From a QString:
// std::filesystem::path(qstring.toStdWString()).
std::vector<SplatVertex> LoadSplatPly(const std::filesystem::path& path);

// Same as above, but parses a .ply already held in memory (used by the web build,
// where the file arrives as fetched bytes). `label` is only used in error logs.
std::vector<SplatVertex> LoadSplatPlyFromMemory(const unsigned char* data, size_t size, const std::string& label);
