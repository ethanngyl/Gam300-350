#pragma once

#include "SplatData.h"
#include "../gfx/Shader.h"
#include <glm/gtc/matrix_transform.hpp>

#include <memory>
#include <vector>
#include <string>


class SplatModel
{
public:
    void SetSplat(const std::vector<SplatVertex>& splats) { m_splats = splats; }
    const std::vector<SplatVertex>& splats() const { return m_splats; }
    size_t GetCount() const { return m_splats.size(); }

    void SetName(const std::string& name) { m_name = name; }
    const std::string& GetName() const { return m_name; }

    void SetTransform(const glm::mat4& t) { m_transform = t; }
    const glm::mat4& GetTransform() const { return m_transform; }
    void Translate(const glm::vec3& delta) { m_transform = glm::translate(m_transform, delta); }

private:
    unsigned int m_vao = 0; //Vertex Buffer Object
    unsigned int m_vbo = 0; //Vertex Array Object
    size_t m_count = 0;
    std::shared_ptr<Shader> m_shader; //Shared pointer to the shader

    glm::mat4 m_transform = glm::mat4(1);
    std::string m_name;
    std::vector<SplatVertex> m_splats; //Copy of splat data
};