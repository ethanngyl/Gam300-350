#pragma once

#include "SplatData.h"
#include "../gfx/Shader.h"

#include <memory>
#include <vector>

class SplatModel
{
public:

    void SetSplat(const std::vector<SplatVertex>& splats);
    void Draw(const glm::mat4& viewProj, float viewportHeightPixels) const;

private:
    unsigned int m_vao = 0;
    unsigned int m_vbo = 0;
    size_t m_count = 0;
    std::unique_ptr<Shader> m_shader;

    std::vector<SplatVertex> m_splats; //Copy of splat data
};