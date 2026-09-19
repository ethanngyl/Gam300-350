#include "SplatRenderer.h"

#include <GL/glew.h>

#include <cstddef>

namespace {

const char* kVertexShaderSrc = R"(
#version 330 core
layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aPointSize;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aAlpha;

uniform mat4 uViewProj;
uniform float uPixelsPerUnit;

out vec3 vColor;
out float vAlpha;

void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    gl_Position = uViewProj * vec4(aPosition, 1.0);
    gl_PointSize = max(aPointSize * uPixelsPerUnit / gl_Position.w, 1.0);
}
)";

const char* kFragmentShaderSrc = R"(
#version 330 core
in vec3 vColor;
in float vAlpha;

out vec4 FragColor;

void main() {
    vec2 coord = gl_PointCoord * 2.0 - 1.0;
    float dist2 = dot(coord, coord);
    if (dist2 > 1.0) discard;
    float falloff = 1.0 - dist2;
    FragColor = vec4(vColor, vAlpha * falloff);
}
)";

} // namespace

SplatRenderer::SplatRenderer() {
    m_shader = std::make_shared<Shader>(kVertexShaderSrc, kFragmentShaderSrc);
}

SplatRenderer::~SplatRenderer() {
    m_splatModels.clear(); //Removed unique ptrs
}

void SplatRenderer::SetSplats(const std::vector<SplatVertex>& splats) {
    std::unique_ptr< SplatModel>model = std::make_unique<SplatModel>(m_shader);
    model.get()->SetSplat(splats);
    m_splatModels.push_back(std::move(model));
    model = nullptr;
}

void SplatRenderer::Draw(const glm::mat4& viewProj, float viewportHeightPixels) const {

    for (const std::unique_ptr<SplatModel>& model : m_splatModels)
    {
        model.get()->Draw(viewProj, viewportHeightPixels);
    }
}

size_t SplatRenderer::SplatCount() const
{
    size_t count = 0;

    for (const std::unique_ptr<SplatModel>& model : m_splatModels)
        count += model.get()->SplatCount();

    return count;
}
