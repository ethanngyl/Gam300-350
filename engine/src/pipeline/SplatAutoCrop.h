/*!************************************************************************
\file SplatAutoCrop.h
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 24-11-2026
\brief
Declares AutoCropSplatPly, a C++ port of tools/auto_crop.py so local builds
need no Python. It keeps only the object a walk-around capture was taken
around, worked out from COLMAP's camera poses: the point the photos look at
is the centre, the path the cameras trace (closed by mirroring it through
the centre) is the footprint seen from above, and the height is cut where
COLMAP's points thin out above the object (before a ceiling) and below the
floor. Splats outside are removed. Captures that don't surround one object
are left alone. Same maths and thresholds as the script, so a model built on
this PC is cropped the same as one built by the backend.
**************************************************************************/
#pragma once

#include <QString>

// What AutoCropSplatPly did.
struct AutoCropReport {
    bool cropped = false;   // false: the capture doesn't suit a crop, see reason
    QString reason;         // why nothing was cropped
    qint64 kept = 0;        // splats kept / in the input, when cropped
    qint64 total = 0;
    int camerasAimed = 0;   // photos whose view passes near the centre
    int cameras = 0;        // photos with a camera position
    double arcDegrees = 0.0; // how far round the object the cameras go
};

// sparseDir: COLMAP's sparse/ folder (the reconstruction with the most
// registered images is used, as Brush does). input: Brush's export, in
// COLMAP's coordinates (binary_little_endian, all-float properties). output
// is written only when report.cropped is set. Returns an empty string on
// success (cropped or skipped), else what went wrong. heightFactor caps the
// height kept above and below the centre, in camera distances; the crop is
// skipped if it would keep less than minKeep of the splats. Safe to call
// from a worker thread.
QString AutoCropSplatPly(const QString& sparseDir, const QString& input, const QString& output,
                         AutoCropReport& report, double heightFactor = 1.0, double minKeep = 0.05);
