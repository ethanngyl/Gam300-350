/******************************************************************************
 * File:        CropBoxRenderer.h
 * Project:     Genesis
 *
 * Description:
 * Draws the crop box as a wireframe cube. The cube is a fixed unit cube
 * on the GPU, placed in the world by the box's transform.
 ******************************************************************************/
#pragma once

#include "Shader.h"

#include <glm/glm.hpp>

#include <memory>

class CropBoxRenderer
{
public:
    CropBoxRenderer();
    ~CropBoxRenderer();

    CropBoxRenderer(const CropBoxRenderer&) = delete;
    CropBoxRenderer& operator=(const CropBoxRenderer&) = delete;

    //Draws on top of the scene over all models
    void Draw(const glm::mat4& viewProj, const glm::mat4& boxTransform, const glm::vec3& color);

private:
    std::unique_ptr<Shader> m_shader;
    unsigned int m_vao = 0;
    unsigned int m_vbo = 0;
    unsigned int m_ebo = 0;
};
