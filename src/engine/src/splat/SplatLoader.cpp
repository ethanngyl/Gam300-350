#include "SplatLoader.h"

#include <happly.h>

#include <iostream>

std::vector<SplatVertex> LoadSplatPly(const std::string& path) {
    try {
        happly::PLYData ply(path);
        happly::Element& vertex = ply.getElement("vertex");

        std::vector<float> x = vertex.getProperty<float>("x");
        std::vector<float> y = vertex.getProperty<float>("y");
        std::vector<float> z = vertex.getProperty<float>("z");

        std::vector<float> scale0 = vertex.getProperty<float>("scale_0");
        std::vector<float> scale1 = vertex.getProperty<float>("scale_1");
        std::vector<float> scale2 = vertex.getProperty<float>("scale_2");

        std::vector<float> opacity = vertex.getProperty<float>("opacity");

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

            v.color = splat_decode::decodeColor(fDc0[i], fDc1[i], fDc2[i]);
            v.alpha = splat_decode::decodeOpacity(opacity[i]);

            result.push_back(v);
        }

        return result;
    } catch (const std::exception& e) {
        std::cerr << "[SplatLoader] failed to load '" << path << "': " << e.what() << std::endl;
        return {};
    }
}
