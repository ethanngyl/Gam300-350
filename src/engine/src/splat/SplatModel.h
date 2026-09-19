#pragma once

#include "SplatData.h"
#include "../gfx/Shader.h"

#include <memory>
#include <vector>

class SplatModel
{
public:
    SplatModel(std::shared_ptr<Shader> shader);
    ~SplatModel();

    SplatModel() = delete;
    SplatModel& operator=(const SplatModel) = delete;

    void SetSplat(const std::vector<SplatVertex>& splats);
    void Draw(const glm::mat4& viewProj, float viewportHeightPixels) const;

    size_t SplatCount() const { return m_count; }

private:
    unsigned int m_vao = 0; //Vertex Buffer Object
    unsigned int m_vbo = 0; //Vertex Array Object
    size_t m_count = 0;
    std::shared_ptr<Shader> m_shader; //Shared pointer to the shader

    std::vector<SplatVertex> m_splats; //Copy of splat data
};