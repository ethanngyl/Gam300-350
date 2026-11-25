/******************************************************************************
 * File:        GridRenderer.h
 * Project:     Genesis
 *
 * Description:
 * Draws the editor's reference grid on the ground plane (y = 0) with the
 * world axes on top of it: X red, Y green, Z blue. Thin lines every
 * kMinorStep units and brighter ones every whole unit, so a model's
 * position can be read off the grid. The grid fades out towards its edge.
 *
 * The grid always draws behind the models: splats are drawn without depth
 * testing, so a model's lower half (below y = 0) still covers the lines.
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
    //Thin lines per world unit. Set as a whole number so every kMinorPerUnit-th line lands exactly
    //on a whole unit (a step like 0.3 can't divide 1, and would put the "unit" lines every 0.9 units).
    static constexpr int kMinorPerUnit = 4;
    static_assert(kMinorPerUnit >= 1, "kMinorPerUnit must be at least 1");
    //Spacing of the thin lines; every kMinorPerUnit-th line is a whole unit and drawn brighter
    static constexpr float kMinorStep = 1.0f / static_cast<float>(kMinorPerUnit);
    //Lines start fading out this far from the centre and are gone at kExtent.
    //Grid labels stop before it so none float over faded lines.
    static constexpr float kFadeStart = kExtent * 0.6f;

    GridRenderer();
    ~GridRenderer();

    GridRenderer(const GridRenderer&) = delete;
    GridRenderer& operator=(const GridRenderer&) = delete;

    //Draws without depth testing or depth writes. Call before the models so they draw over it.
    void Draw(const glm::mat4& viewProj);

private:
    std::unique_ptr<Shader> m_shader;
    unsigned int m_vao = 0;
    unsigned int m_vbo = 0;
    int m_vertexCount = 0;
};
