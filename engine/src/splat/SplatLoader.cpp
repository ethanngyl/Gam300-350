/******************************************************************************
 * File:        SplatLoader.h
 * Project:     Genesis
 * Author(s):	Ethan Ng Yong Le   (Primary, 60%)  - Created base logic/function
 *              Clement Ang Yang Ying   (Secondary, 40%) - Updated function with gausian splat
 *
 *
 * Description:
 * This file contains the declaration for the function LoadSplatPly, which loads a .ply file
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#include "SplatLoader.h"

#include <happly.h>

#include <iostream>
#include <istream>
#include <streambuf>

namespace {

//Read-only streambuf over an existing byte range, so happly can parse it without a copy
struct MemoryStreamBuf : std::streambuf {
    MemoryStreamBuf(const unsigned char* data, size_t size) {
        char* begin = const_cast<char*>(reinterpret_cast<const char*>(data));
        setg(begin, begin, begin + size);
    }
};

//Decodes the vertex element of an already-parsed .ply. Throws on missing properties.
std::vector<SplatVertex> DecodeSplats(happly::PLYData& ply) {
    happly::Element& vertex = ply.getElement("vertex");

    std::vector<float> x = vertex.getProperty<float>("x");
    std::vector<float> y = vertex.getProperty<float>("y");
    std::vector<float> z = vertex.getProperty<float>("z");

    std::vector<float> scale0 = vertex.getProperty<float>("scale_0");
    std::vector<float> scale1 = vertex.getProperty<float>("scale_1");
    std::vector<float> scale2 = vertex.getProperty<float>("scale_2");

    //Orientation quaternion, needed by gaussian covariance matrix (square matrix)
    std::vector<float> rot0 = vertex.getProperty<float>("rot_0");
    std::vector<float> rot1 = vertex.getProperty<float>("rot_1");
    std::vector<float> rot2 = vertex.getProperty<float>("rot_2");
    std::vector<float> rot3 = vertex.getProperty<float>("rot_3");

    std::vector<float> opacity =vertex.getProperty<float>("opacity");

    std::vector<float> fDc0 = vertex.getProperty<float>("f_dc_0");
    std::vector<float> fDc1 = vertex.getProperty<float>("f_dc_1");
    std::vector<float> fDc2 = vertex.getProperty<float>("f_dc_2");

    size_t count = x.size();
    std::vector<SplatVertex> result;
    result.reserve(count);

    for (size_t i = 0; i < count; ++i) {
        SplatVertex v{};
        v.position = glm::vec3(x[i], y[i], z[i]);

        float avgLogScale = (scale0[i] + scale1[i] + scale2[i]) / 3.0f;
        v.pointSize = splat_decode::decodeScale(avgLogScale);

        // Full per-axis scale (log-encoded in the file) for Gaussian splat mode
        v.scale = glm::vec3(splat_decode::decodeScale(scale0[i]),
                            splat_decode::decodeScale(scale1[i]),
                            splat_decode::decodeScale(scale2[i]));

        // The position below is flipped in y ("upside down fix"), which is a reflection
        // F = diag(1,-1,1). The covariance must be reflected the same way: F R S S R^T F.
        // F R F is itself a rotation; conjugating by a reflection maps the quaternion
        // (w,x,y,z) to (w,-x,y,-z), and F S S F = S S because S is diagonal.
        glm::vec4 q = splat_decode::decodeRotation(rot0[i], rot1[i], rot2[i], rot3[i]);
        v.rotation = glm::vec4(q.x, -q.y, q.z, -q.w);

        v.color = splat_decode::decodeColor(fDc0[i], fDc1[i], fDc2[i]);
        v.alpha = splat_decode::decodeOpacity(opacity[i]);
        v.position = glm::vec3(x[i], -y[i], z[i]); //Upside down fix
        result.push_back(v);
    }

    return result;
}

} // namespace

std::vector<SplatVertex> LoadSplatPly(const std::string& path) {
    try {
        happly::PLYData ply(path);
        return DecodeSplats(ply);
    } catch (const std::exception& e) {
        std::cerr << "[SplatLoader] failed to load '" << path << "': " << e.what() << std::endl;
        return {};
    }
}

std::vector<SplatVertex> LoadSplatPlyFromMemory(const unsigned char* data, size_t size, const std::string& label) {
    try {
        MemoryStreamBuf buf(data, size);
        std::istream stream(&buf);
        happly::PLYData ply(stream);
        return DecodeSplats(ply);
    } catch (const std::exception& e) {
        std::cerr << "[SplatLoader] failed to load '" << label << "': " << e.what() << std::endl;
        return {};
    }
}
