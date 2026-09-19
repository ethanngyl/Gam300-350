#pragma once

#include "SplatData.h"
#include "SplatModel.h"
#include "../gfx/Shader.h"

#include <glm/glm.hpp>

#include <memory>
#include <vector>

// Renders decoded splats as flat, alpha-blended circular point sprites.
// No depth sorting or covariance/rotation-aware splatting at M1 -- "flat
// blobs" is the explicit bar for the engine-foundation milestone.
// Supports specifically 3DGS type .ply files (not just normal .ply)
class SplatRenderer {
public:
    SplatRenderer();
    ~SplatRenderer();

    SplatRenderer(const SplatRenderer&) = delete;
    SplatRenderer& operator=(const SplatRenderer&) = delete;

    void SetSplats(const std::vector<SplatVertex>& splats);
    void Draw(const glm::mat4& viewProj, float viewportHeightPixels) const;

    size_t ModelCount() const { return m_modelCount; }
    size_t SplatCount() const;

private:
    size_t m_modelCount = 0; //Number of models
    std::shared_ptr<Shader> m_shader; //Shared pointer of shader used
    std::vector<std::unique_ptr<SplatModel>> m_splatModels; //Vector storing the splat model unique ptrs
};
