#pragma once

#include "SplatData.h"
#include "SplatModel.h"
#include "../gfx/Shader.h"
#include "../Manager/InputManager.h"

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

    void SetSplats(const std::vector<SplatVertex>& splats, std::string splatname);
    //Updates a model
    void UpdateModel(SplatModel* model, const std::vector<SplatVertex>& splats);
    //Moves model
    void TranslateModel(SplatModel* model, const glm::vec3& delta);
    void Draw(const glm::mat4& viewProj, float viewportHeightPixels, const glm::vec3& camPos);

    std::string GetModelName(size_t indexNum);

    size_t ModelCount() const { return m_modelCount; }
    size_t TotalCreatedCount() const { return m_totalCreatedCount; }
    size_t SplatCount() const;

    void NudgeSplatForward(InputManager& manager, InputManager::INPUT_TYPE type);
    void NudgeSplatBackwards(InputManager& manager, InputManager::INPUT_TYPE type);
    void NudgeSplatLeft(InputManager& manager, InputManager::INPUT_TYPE type);
    void NudgeSplatRight(InputManager& manager, InputManager::INPUT_TYPE type);

private:
    void RebuildCombinedBuffer();

    //Sorting Vars
    static constexpr int kMaxModels = 32; //Must match uModelTransforms[] size in the shader
    static constexpr float kSortBudgetMs = 4.0f; //Alloclated sorting time
    static constexpr int kDisableAfterFrames = 3; //How many frames overbudget to disable
    static constexpr int kReEnableAfterFrames = 120; //How many frames to reenable sorting
    bool m_sortEnabled = false;
    int m_framesOverBudget = 0;
    int m_framesUnderBudget = 0;

    unsigned int m_vao = 0; //Vertex Array Object, holds attributes (e.g. glVertexAttribPointer) and which vbo/ebo are bound
    unsigned int m_vbo = 0; //Vertex Buffer Object, holds splat data
    unsigned int m_ebo = 0; //Element Buffer Object, holds draw order

    size_t m_modelCount = 0; //Number of models
    size_t m_totalCreatedCount = 0; //Total number of models ever created

    bool m_modified = true;

    std::vector<SplatVertex> m_combined; //CPU copy for sorting
    std::shared_ptr<Shader> m_shader; //Shared pointer of shader used
    std::vector<std::unique_ptr<SplatModel>> m_models; //Vector storing the splat model unique ptrs
};
