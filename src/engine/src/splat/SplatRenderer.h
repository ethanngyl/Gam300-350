#pragma once

#include "SplatData.h"
#include "../gfx/Shader.h"

#include <glm/glm.hpp>

#include <memory>
#include <vector>

// Renders decoded splats as flat, alpha-blended circular point sprites.
// No depth sorting or covariance/rotation-aware splatting at M1 -- "flat
// blobs" is the explicit bar for the engine-foundation milestone.
class SplatRenderer {
public:
    SplatRenderer();
    ~SplatRenderer();

    SplatRenderer(const SplatRenderer&) = delete;
    SplatRenderer& operator=(const SplatRenderer&) = delete;

    void setSplats(const std::vector<SplatVertex>& splats);
    void draw(const glm::mat4& viewProj, float viewportHeightPixels) const;

    size_t splatCount() const { return m_count; }

private:
    unsigned int m_vao = 0;
    unsigned int m_vbo = 0;
    size_t m_count = 0;
    std::unique_ptr<Shader> m_shader;

    std::vector<SplatVertex> m_splats; //Copy of splat data
};
