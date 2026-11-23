/******************************************************************************
 * File:        GridRenderer.h
 * Project:     Genesis
 *
 * Description:
 * Draws the editor's reference grid on the ground plane (y = 0) with the
 * world axes on top of it: X red, Y green, Z blue. Thin lines every
 * kMinorStep units and brighter ones every whole unit, so a model's
 * position can be read off the grid. The grid fades out towards its edge.
 ******************************************************************************/
#pragma once

#include "Shader.h"

#include <glm/glm.hpp>

#include <memory>

class GridRenderer
{
public:
    //Half the width of the grid, in world units (it spans -kExtent..kExtent on X and Z)
    static constexpr float kExtent = 10.0f;
    //Spacing of the thin lines; every 1 / kMinorStep-th line is a whole unit and drawn brighter
    static constexpr float kMinorStep = 0.25f;

    GridRenderer();
    ~GridRenderer();

    GridRenderer(const GridRenderer&) = delete;
    GridRenderer& operator=(const GridRenderer&) = delete;

    //Draws depth tested but without writing depth, so it never hides a model.
    //Call before the models so they blend over it.
    void Draw(const glm::mat4& viewProj);

private:
    std::unique_ptr<Shader> m_shader;
    unsigned int m_vao = 0;
    unsigned int m_vbo = 0;
    int m_vertexCount = 0;
};
