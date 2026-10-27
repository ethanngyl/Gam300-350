/******************************************************************************
 * File:        SplatExporter.h
 * Project:     Genesis
 * Author(s):	Ethan Ng Yong Le   (Primary, 100%)
 *
 * Description:
 * This file contains the declarations for ExportSplats, which converts loaded
 * Gaussian splats into other 3D file formats (splat .ply/.splat, point cloud
 * .ply, .obj, .glb and .stl) so they can be used in other tools.
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#pragma once

#include "SplatData.h"

#include <glm/glm.hpp>

#include <cstddef>
#include <filesystem>
#include <string>
#include <vector>

enum class ExportFormat {
    GaussianPly,   //3DGS .ply (re-importable, DC colour only)
    SplatFile,     //antimatter15 .splat (32 bytes per splat, used by web viewers)
    PointCloudPly, //Plain coloured .ply (MeshLab, CloudCompare, Blender)
    Obj,           //Wavefront .obj with vertex colours
    Glb,           //Binary glTF 2.0 with vertex colours (Blender, Unity, Unreal, three.js)
    Stl            //Binary .stl, mesh only, no colour (3D printing, CAD)
};

enum class ExportGeometry {
    Points, //One vertex per splat
    Mesh    //One small ellipsoid per splat, shaped by its scale and rotation
};

struct ExportOptions {
    ExportFormat format = ExportFormat::Glb;
    ExportGeometry geometry = ExportGeometry::Points; //Ignored by formats that only support one
    bool highDetailMesh = false; //Mesh ellipsoids: false = octahedron (8 tris), true = icosahedron (20 tris)
    float sigmaScale = 1.5f;     //Mesh ellipsoid radius, in standard deviations of the Gaussian
    float minAlpha = 0.0f;       //Skip splats fainter than this (0 = keep all)
};

//One model's splats (in model space) plus the transform that places it in the scene
struct ExportSource {
    const std::vector<SplatVertex>* splats = nullptr;
    glm::mat4 transform = glm::mat4(1.0f);
};

struct ExportResult {
    bool ok = false;
    std::string error; //Set when !ok
    size_t splatCount = 0;
    size_t vertexCount = 0;
    size_t triangleCount = 0;
};

//Writes every source into one file at path. Transforms are baked in, so the export
//matches what the viewport shows. Safe to call from a worker thread.
ExportResult ExportSplats(const std::vector<ExportSource>& sources, const std::filesystem::path& path,
                          const ExportOptions& options);

const char* ExportFormatExtension(ExportFormat format); //e.g. ".glb"
const char* ExportFormatName(ExportFormat format);      //e.g. "glTF Binary"
bool ExportFormatSupportsPoints(ExportFormat format);
bool ExportFormatSupportsMesh(ExportFormat format);
