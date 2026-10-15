/******************************************************************************
 * File:        SplatRenderer.h
 * Project:     Genesis
 * Author(s):	Clement Ang Yang Ying   (Primary, 90%) - Transformed class to manage/modify models and drawing them
 *              Ethan Ng Yong Le    (Secondary, 10%) - Created base class
 *
 * Description:
 * This file contains the declaration for the class SplatRenderer
 * This class stores the model data class and renders them
 * It also calls translate on them when required
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#pragma once

#include "SplatData.h"
#include "SplatModel.h"
#include "../gfx/Shader.h"
#include "../Manager/InputManager.h"

#include <glm/glm.hpp>

#include <memory>
#include <vector>

// Renders decoded splats in one of two modes (see RenderMode):
//  - PointCloud:    flat, alpha-blended circular point sprites (no sorting, no covariance).
//  - GaussianSplat: each splat is projected to an oriented 2D Gaussian ellipse and the
//                   splats are blended back-to-front.
// Supports specifically 3DGS type .ply files (not just normal .ply)
class SplatRenderer {
public:
    enum class RenderMode {
        PointCloud,
        GaussianSplat
    };

    static constexpr int kMaxModels = 32; //Must match uModelTransforms[] size in the shader

    SplatRenderer();
    ~SplatRenderer();

    SplatRenderer(const SplatRenderer&) = delete;
    SplatRenderer& operator=(const SplatRenderer&) = delete;

    void SetSplats(const std::vector<SplatVertex>& splats, std::string splatname);
    //Removes a model and fixes up the selection; out-of-range indices are ignored
    void RemoveModel(int index);
    //Direct access for editor panels (transform, name); nullptr if out of range
    SplatModel* GetModel(int index);
    //Updates a model
    void UpdateModel(SplatModel* model, const std::vector<SplatVertex>& splats);
    //Moves model
    void TranslateModel(SplatModel* model, const glm::vec3& delta);
    //View and projection are passed separately because Gaussian mode needs the view-space
    //position of each splat and the projection's focal lengths, not just their product.
    void Draw(const glm::mat4& view, const glm::mat4& proj, float viewportWidthPixels,
              float viewportHeightPixels, const glm::vec3& camPos);

    void SetRenderMode(RenderMode mode) { m_renderMode = mode; }
    RenderMode GetRenderMode() const { return m_renderMode; }

    std::string GetModelName(size_t indexNum);

    size_t ModelCount() const { return m_models.size(); }
    size_t TotalCreatedCount() const { return m_totalCreatedCount; }
    size_t TotalSplatCount() const;
    size_t GetSplatCount(int modelIndex) const;

    int GetSelectedModel();
    void SelectModel(int index);

    void NudgeSplatForward(InputManager& manager, InputManager::INPUT_TYPE type);
    void NudgeSplatBackwards(InputManager& manager, InputManager::INPUT_TYPE type);
    void NudgeSplatLeft(InputManager& manager, InputManager::INPUT_TYPE type);
    void NudgeSplatRight(InputManager& manager, InputManager::INPUT_TYPE type);

private:
    void RebuildCombinedBuffer();

    //The original flat point sprite path
    void DrawPointCloud(const glm::mat4& viewProj, float viewportHeightPixels, const glm::vec3& camPos);
    //Oriented, sorted Gaussian ellipse path
    void DrawGaussian(const glm::mat4& view, const glm::mat4& proj, float viewportWidthPixels, float viewportHeightPixels);
    //Fills the element buffer with splat indices ordered far -> near (only re-sorts if needed)
    void SortSplatsBackToFront(const glm::mat4& view);

    RenderMode m_renderMode = RenderMode::PointCloud;

    //Gaussian sort cache, lets us skip the sort while nothing moved
    bool m_sortDirty = true;
    glm::mat4 m_lastSortView = glm::mat4(1.0f);
    std::vector<glm::mat4> m_lastSortTransforms;
    std::vector<float> m_sortKeys;          //View-space depth per splat
    std::vector<unsigned int> m_sortOrder;  //Splat indices, far to near

    //Sorting Vars
    static constexpr float kSortBudgetMs = 4.0f; //Alloclated sorting time
    static constexpr int kDisableAfterFrames = 3; //How many frames overbudget to disable
    static constexpr int kReEnableAfterFrames = 120; //How many frames to reenable sorting
    bool m_sortEnabled = false;
    int m_framesOverBudget = 0;
    int m_framesUnderBudget = 0;

    unsigned int m_vao = 0; //Vertex Array Object, holds attributes (e.g. glVertexAttribPointer) and which vbo/ebo are bound
    unsigned int m_vbo = 0; //Vertex Buffer Object, holds splat data
    unsigned int m_ebo = 0; //Element Buffer Object, holds draw order

#ifdef CODEFINE_GLES
    //WebGL2/GLES3 has no geometry shaders, so Gaussian mode draws one instanced quad per
    //splat instead. The splat data lives in a float texture (4 texels per SplatVertex) and
    //the per-instance attribute is the sorted splat index, so sorting only re-uploads indices.
    void UploadSplatTexture();
    unsigned int m_quadVao = 0;      //Quad corners + per-instance splat index
    unsigned int m_quadVbo = 0;      //The 4 corners of the unit quad
    unsigned int m_orderVbo = 0;     //Per-instance splat index, far -> near
    unsigned int m_splatTexture = 0; //RGBA32F copy of m_combined
    std::vector<unsigned int> m_sortBucketCounts; //Counting sort scratch
#endif

    size_t m_totalSplatCount = 0; //Number of models
    size_t m_totalCreatedCount = 0; //Total number of models ever created

    int m_selectedModelIndex = -1;

    bool m_modified = true;

    std::vector<SplatVertex> m_combined; //CPU copy for sorting
    std::shared_ptr<Shader> m_shader; //Shared pointer of shader used (point cloud mode)
    std::shared_ptr<Shader> m_gaussianShader; //Shader used by Gaussian splat mode
    std::vector<std::unique_ptr<SplatModel>> m_models; //Vector storing the splat model unique ptrs
};
