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
    //Spacing of the thin lines; every 1 / kMinorStep-th line is a whole unit and drawn brighter
    static constexpr float kMinorStep = 0.25f;
    //Lines start fading out this far from the centre and are gone at kExtent.
    //Grid labels stop before it so none float over faded lines.
    static constexpr float kFadeStart = kExtent * 0.6f;

    //The whole unit lines are every 1 / kMinorStep minor lines, so that has to be a whole number
    //(0.3 would round to 3 and put the "unit" lines every 0.9 units)
    static constexpr float kMinorPerUnit = 1.0f / kMinorStep;
    static_assert(kMinorStep > 0.0f && kMinorStep <= 1.0f, "kMinorStep must be in (0, 1]");
    static_assert(kMinorPerUnit - static_cast<float>(static_cast<int>(kMinorPerUnit + 0.5f)) < 1e-4f &&
                  static_cast<float>(static_cast<int>(kMinorPerUnit + 0.5f)) - kMinorPerUnit < 1e-4f,
                  "kMinorStep must divide 1 evenly (0.5, 0.25, 0.2, 0.1, ...)");

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
