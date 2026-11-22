/*!************************************************************************
\file PlyNormalizer.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
Declares NormalizeSplatPly, a C++ port of tools/normalize_ply.py so local
builds need no Python. COLMAP / Brush reconstruct in an arbitrary frame
(object far from the origin, arbitrary scale); this recentres the splat on
its median point and scales it so 90% of splats lie within targetRadius,
adding ln(factor) to the log-encoded scale_0..2 so the gaussians keep their
shape. The PLY header (including Brush's "Vertical axis" comment) is kept
byte for byte. Same maths and defaults as the script, so a model built on
this PC frames the same as one built by the backend.
**************************************************************************/
#pragma once

#include <QString>

// Reads input (binary_little_endian, all-float vertex properties, as Brush
// writes), normalizes it and writes output. Returns an empty string on
// success, else what went wrong. summary (optional) gets a one-line report.
// Safe to call from a worker thread.
QString NormalizeSplatPly(const QString& input, const QString& output, double targetRadius = 1.5,
                          QString* summary = nullptr);
