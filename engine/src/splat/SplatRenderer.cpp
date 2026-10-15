/******************************************************************************
 * File:        SplatRenderer.cpp
 * Project:     Genesis
 * Author(s):	Clement Ang Yang Ying   (Primary, 90%) - Transformed class to manage models and drawing them
 *              Ethan Ng Yong Le    (Secondary, 10%) - Created base class and shader
 *
 * Description:
 * This file contains the definition for the class SplatRenderer
 * This class stores the model data class and renders them
 * It also calls translate on them when required
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#include "SplatRenderer.h"

#include <GL/glew.h>

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <filesystem>
#include <numeric>
#include <iostream>

namespace {

const char* kVertexShaderSrc = R"(
#version 330 core
layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aPointSize;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aAlpha;
layout(location = 4) in float aModelId;

uniform mat4 uViewProj;
uniform float uPixelsPerUnit;
uniform mat4 uModelTransforms[32]; //Must match SplatRenderer::kMaxModels

out vec3 vColor;
out float vAlpha;

void main() {
    mat4 model = uModelTransforms[int(aModelId)];
    vec4 worldPos = model * vec4(aPosition, 1.0);

    vColor = aColor;
    vAlpha = aAlpha;
    gl_Position = uViewProj * worldPos;
    gl_PointSize = max(aPointSize * uPixelsPerUnit / gl_Position.w, 1.0);
}
)";

const char* kFragmentShaderSrc = R"(
#version 330 core
in vec3 vColor;
in float vAlpha;

out vec4 FragColor;

void main() {
    vec2 coord = gl_PointCoord * 2.0 - 1.0;
    float dist2 = dot(coord, coord);
    if (dist2 > 1.0) discard;
    float falloff = 1.0 - dist2;
    FragColor = vec4(vColor, vAlpha * falloff);
}
)";

// ---------------------------------------------------------------------------
// Gaussian splat shaders
//
// Pipeline: 
// vertex shader: projects the 3D covariance to a 2D ellipse (per splat)
// geometry shader: expands each point into a quad that bounds the ellipse
// fragment shader: evaluates the 2D Gaussian falloff per pixel
// ---------------------------------------------------------------------------

//vertex shader: projects the 3D covariance to a 2D ellipse (per splat)
const char* kGaussianVertexShaderSrc = R"(
#version 330 core
layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aAlpha;
layout(location = 4) in float aModelId;
layout(location = 5) in vec3 aScale;    // per-axis std-dev
layout(location = 6) in vec4 aRotation; // quaternion (w, x, y, z)

uniform mat4 uView;
uniform mat4 uProj;
uniform vec2 uViewport; // framebuffer size in pixels
uniform mat4 uModelTransforms[32]; //Must match SplatRenderer::kMaxModels

out vec3 vColor;
out float vAlpha;
out vec2 vAxis1;  // ellipse major axis, 1 sigma long, in NDC units
out vec2 vAxis2;  // ellipse minor axis, 1 sigma long, in NDC units
out float vValid; // 0 = splat is culled, geometry shader emits nothing

// Quaternion (w,x,y,z) -> 3x3 rotation matrix. GLSL matrices are column-major,
// so each group of three numbers below is one column.
mat3 quatToMat3(vec4 q) {
    float w = q.x, x = q.y, y = q.z, z = q.w;
    return mat3(
        1.0 - 2.0*(y*y + z*z), 2.0*(x*y + w*z),       2.0*(x*z - w*y),
        2.0*(x*y - w*z),       1.0 - 2.0*(x*x + z*z), 2.0*(y*z + w*x),
        2.0*(x*z + w*y),       2.0*(y*z - w*x),       1.0 - 2.0*(x*x + y*y));
}

void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vValid = 1.0;

    //Step 1: splat center in view space (camera looks down -z, so visible t.z < 0)
    mat4 modelView = uView * uModelTransforms[int(aModelId)];
    vec4 t = modelView * vec4(aPosition, 1.0);

    //Cull splats behind the camera
    if (t.z > -0.01) {
        vValid = 0.0;
        vAxis1 = vec2(0.0);
        vAxis2 = vec2(0.0);
        gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    vec4 clip = uProj * t;

    //Step 2: 3D covariance factor.
    //The covariance matrix (Sigma) is a 3x3 table of numbers that describes the shape of the
    //splat's fuzzy ellipsoid: how wide it is along each direction, and which way it is pointing.
    //  S = diagonal matrix of the 3 widths (scale_0..2): a blob stretched along the x, y, z axes
    //  R = rotation matrix (from the quaternion rot_0..3): turns that blob to its real orientation
    //  Sigma = R S S^T R^T  ("stretch, then rotate"), so it always describes a valid ellipsoid
    //We never build Sigma itself. We keep A = W R S, where W is the rotation part of modelView
    //(world -> view), so that Sigma(view space) = A A^T. This is cheaper, and A A^T can never
    //be an invalid (negative sized) ellipsoid, which a hand-built Sigma could be after rounding.
    mat3 S = mat3(aScale.x, 0.0, 0.0,
                  0.0, aScale.y, 0.0,
                  0.0, 0.0, aScale.z);
    mat3 A = mat3(modelView) * quatToMat3(normalize(aRotation)) * S;

    //Step 3: Jacobian of the perspective projection at the splat center.
    //Focal lengths in pixels come straight from the projection matrix.
    float fx = uProj[0][0] * uViewport.x * 0.5;
    float fy = uProj[1][1] * uViewport.y * 0.5;

    //The linearisation is only accurate near the screen center, so clamp the center to 1.3x the frustum edge to stop J exploding for off-screen splats.
    float limX = 1.3 / uProj[0][0];
    float limY = 1.3 / uProj[1][1];
    float tx = clamp(t.x / t.z, -limX, limX) * t.z;
    float ty = clamp(t.y / t.z, -limY, limY) * t.z;

    //Rows of J (2x3): u = -fx*x/z, v = -fy*y/z, differentiated w.r.t. (x,y,z)
    vec3 j0 = vec3(-fx / t.z, 0.0, fx * tx / (t.z * t.z));
    vec3 j1 = vec3(0.0, -fy / t.z, fy * ty / (t.z * t.z));

    //Step 4: squash the 3x3 covariance down to a 2x2 one (Sigma') that describes the ellipse on the screen, in pixels. J maps "a small move in 3D" to "a small move on screen",
    //so the 3D blob (A A^T) becomes the screen blob J A A^T J^T = B B^T, where B = J A (a 2x3 matrix).
    //The 2x2 result [[covA covB][covB covC]] reads as:
    //  covA = variance along screen x (how wide), covC = variance along screen y (how tall)
    //  covB = how much x and y vary together (non-zero means the ellipse is tilted)
    // (row-vector * matrix in GLSL gives row i of J*A)
    vec3 b0 = j0 * A;
    vec3 b1 = j1 * A;
    // +0.3 px on the diagonal = low-pass filter so sub-pixel splats stay visible
    float covA = dot(b0, b0) + 0.3;
    float covB = dot(b0, b1);
    float covC = dot(b1, b1) + 0.3;

    //Step 5: turn the 2x2 covariance into two ellipse axes we can draw.
    //Eigen-decomposition of [[covA covB][covB covC]] finds the two directions the ellipse is
    //stretched along (eigenvectors, perpendicular to each other) and how stretched it is along
    //each (eigenvalues = variance, so sqrt(eigenvalue) = std-dev = the 1 sigma length in pixels).
    //lambda1 is the larger (major axis), lambda2 the smaller (minor axis).
    float mid = 0.5 * (covA + covC);
    float det = covA * covC - covB * covB;
    float disc = sqrt(max(0.1, mid * mid - det));
    float lambda1 = mid + disc;
    float lambda2 = max(mid - disc, 0.01);

    vec2 v1 = (abs(covB) < 1e-6) ? vec2(1.0, 0.0) : normalize(vec2(covB, lambda1 - covA));
    vec2 v2 = vec2(-v1.y, v1.x);

    //Step 6: convert the axes from pixels to NDC.
    //NDC (Normalized Device Coordinates) is the screen mapped onto a fixed -1..+1 box in x and y,
    //whatever the window size, so it spans 2 units over the viewport: 1 pixel = 2 / size NDC units.
    vec2 pixelToNdc = 2.0 / uViewport;
    vAxis1 = sqrt(lambda1) * v1 * pixelToNdc;
    vAxis2 = sqrt(lambda2) * v2 * pixelToNdc;

    gl_Position = clip;
}
)";

//geometry shader: expands each point into a quad that bounds the ellipse
const char* kGaussianGeometryShaderSrc = R"(
#version 330 core
layout(points) in;
layout(triangle_strip, max_vertices = 4) out;

in vec3 vColor[];
in float vAlpha[];
in vec2 vAxis1[];
in vec2 vAxis2[];
in float vValid[];

out vec3 gColor;
out float gAlpha;
out vec2 gOffset; // position inside the ellipse, in units of sigma

void main() {
    //Culled by the vertex shader
    if (vValid[0] < 0.5) return;

    vec4 center = gl_in[0].gl_Position;

    //Skip splats whose center is outside the screen
    if (abs(center.x) > 1.3 * center.w || abs(center.y) > 1.3 * center.w) return;

    //Quad of +-3 sigma, which contains ~99% of the Gaussian's energy.
    //Corner order forms a valid triangle strip.
    const float kExtent = 3.0;
    const vec2 corners[4] = vec2[4](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));

    for (int i = 0; i < 4; ++i) {
        //Where this corner is, measured in sigmas along the ellipse axes, e.g. (-3, +3)
        vec2 sigmaOffset = corners[i] * kExtent;
        //NDC offset = the corner's distance from the splat center on screen, in NDC units
        //(0.1 in x = 5% of the screen width, since the full width is 2 units).
        //Walk sigmaOffset.x steps along axis 1 and sigmaOffset.y steps along axis 2 (each axis is
        //1 sigma long). It is scaled by w because gl_Position is in clip space: the GPU divides
        //by w afterwards to get NDC, so multiplying here makes that divide cancel out.
        vec2 ndcOffset = sigmaOffset.x * vAxis1[0] + sigmaOffset.y * vAxis2[0];
        gl_Position = vec4(center.xy + ndcOffset * center.w, center.z, center.w);
        gColor = vColor[0];
        gAlpha = vAlpha[0];
        gOffset = sigmaOffset;
        EmitVertex();
    }
    EndPrimitive();
}
)";

// fragment shader: evaluates the 2D Gaussian falloff per pixel
const char* kGaussianFragmentShaderSrc = R"(
#version 330 core
in vec3 gColor;
in float gAlpha;
in vec2 gOffset;

out vec4 FragColor;

void main() {
    //Squared Mahalanobis distance from the center (gOffset is already in sigma units)
    float d2 = dot(gOffset, gOffset);
    if (d2 > 9.0) discard; // outside 3 sigma, the quad's corners

    // 2D Gaussian: opacity * exp(-1/2 * d^T Sigma'^-1 d)
    float alpha = gAlpha * exp(-0.5 * d2);
    if (alpha < 1.0 / 255.0) discard; // invisible, skip the blend

    FragColor = vec4(gColor, alpha);
}
)";

} // namespace

SplatRenderer::SplatRenderer() {
    m_shader = std::make_shared<Shader>(kVertexShaderSrc, kFragmentShaderSrc);
    m_gaussianShader = std::make_shared<Shader>(kGaussianVertexShaderSrc, kGaussianGeometryShaderSrc, kGaussianFragmentShaderSrc);

    //Alloclate the vao/vbo buffers
    glGenVertexArrays(1, &m_vao);
    glGenBuffers(1, &m_vbo);
    glGenBuffers(1, &m_ebo);

    //Set these as the active buffers, further functions calling the buffers will ref these
    glBindVertexArray(m_vao);
    glBindBuffer(GL_ARRAY_BUFFER, m_vbo);

    //Enables array from buffer, else it will read all as default values
    glEnableVertexAttribArray(0);
    //Set how to read the btyes, casted as SplatVertex, same for the rest
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(SplatVertex),
        reinterpret_cast<void*>(offsetof(SplatVertex, position)));

    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 1, GL_FLOAT, GL_FALSE, sizeof(SplatVertex),
        reinterpret_cast<void*>(offsetof(SplatVertex, pointSize)));

    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, sizeof(SplatVertex),
        reinterpret_cast<void*>(offsetof(SplatVertex, color)));

    glEnableVertexAttribArray(3);
    glVertexAttribPointer(3, 1, GL_FLOAT, GL_FALSE, sizeof(SplatVertex),
        reinterpret_cast<void*>(offsetof(SplatVertex, alpha)));

    glEnableVertexAttribArray(4);
    glVertexAttribPointer(4, 1, GL_FLOAT, GL_FALSE, sizeof(SplatVertex),
        reinterpret_cast<void*>(offsetof(SplatVertex, modelID)));

    //Only read by the Gaussian shader (point cloud shader ignores them)
    glEnableVertexAttribArray(5);
    glVertexAttribPointer(5, 3, GL_FLOAT, GL_FALSE, sizeof(SplatVertex),
        reinterpret_cast<void*>(offsetof(SplatVertex, scale)));

    glEnableVertexAttribArray(6);
    glVertexAttribPointer(6, 4, GL_FLOAT, GL_FALSE, sizeof(SplatVertex),
        reinterpret_cast<void*>(offsetof(SplatVertex, rotation)));

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m_ebo);

    ///Unbinds the vao but setting it to 0
    glBindVertexArray(0);

    m_totalSplatCount = 0;
}

SplatRenderer::~SplatRenderer() {
    m_models.clear(); //Removed unique ptrs
}

void SplatRenderer::SetSplats(const std::vector<SplatVertex>& splats, std::string splatName) {
    std::unique_ptr< SplatModel>model = std::make_unique<SplatModel>();
    model.get()->SetSplat(splats);
    model.get()->SetName(splatName);
    m_models.push_back(std::move(model));
    model = nullptr;
    m_totalCreatedCount++;
    m_modified = true;
}

void SplatRenderer::RemoveModel(int index) {
    if (index < 0 || index >= static_cast<int>(m_models.size()))
        return;

    m_models.erase(m_models.begin() + index);

    //Keep the selection pointing at the same model, or clear it if that model was removed
    if (m_selectedModelIndex == index)
        m_selectedModelIndex = -1;
    else if (m_selectedModelIndex > index)
        --m_selectedModelIndex;

    m_modified = true; //Model IDs in the combined buffer are now stale
}

SplatModel* SplatRenderer::GetModel(int index) {
    if (index < 0 || index >= static_cast<int>(m_models.size()))
        return nullptr;
    return m_models[index].get();
}


void SplatRenderer::UpdateModel(SplatModel* model, const std::vector<SplatVertex>& splats) {
    model->SetSplat(splats);
    m_modified = true;
}

void SplatRenderer::TranslateModel(SplatModel* model, const glm::vec3& delta) {
    model->Translate(delta); // no buffer rebuild needed -- transform is GPU-side
}

void SplatRenderer::Draw(const glm::mat4& view, const glm::mat4& proj, float viewportWidthPixels,
                         float viewportHeightPixels, const glm::vec3& camPos) {

    if (m_modified) RebuildCombinedBuffer();
    if (m_models.size() == 0) return;

    //Both modes draw translucent splats, so neither tests or writes depth
    glDisable(GL_DEPTH_TEST);

    switch (m_renderMode) {
    case RenderMode::GaussianSplat:
        DrawGaussian(view, proj, viewportWidthPixels, viewportHeightPixels);
        break;
    case RenderMode::PointCloud:
    default:
        DrawPointCloud(proj * view, viewportHeightPixels, camPos);
        break;
    }

    glEnable(GL_DEPTH_TEST);
}

void SplatRenderer::DrawGaussian(const glm::mat4& view, const glm::mat4& proj,
                                 float viewportWidthPixels, float viewportHeightPixels) {
    //Spalts are drawn back to front.
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    m_gaussianShader->use();
    m_gaussianShader->setMat4("uView", view);
    m_gaussianShader->setMat4("uProj", proj);
    m_gaussianShader->setVec2("uViewport", glm::vec2(viewportWidthPixels, viewportHeightPixels));

    std::vector<glm::mat4> transforms;
    transforms.reserve(m_models.size());
    for (const auto& model : m_models) transforms.push_back(model->GetTransform());
    m_gaussianShader->setMat4Array("uModelTransforms", transforms);

    glBindVertexArray(m_vao);

    //Blending is order dependent, so the order is far -> near
    SortSplatsBackToFront(view);

    //Each point becomes one ellipse quad in the shader
    glDrawElements(GL_POINTS, static_cast<GLsizei>(m_totalSplatCount), GL_UNSIGNED_INT, 0);

    glBindVertexArray(0);
}

void SplatRenderer::SortSplatsBackToFront(const glm::mat4& view) {
    std::vector<glm::mat4> transforms;
    transforms.reserve(m_models.size());
    for (const auto& model : m_models) transforms.push_back(model->GetTransform());

    //The order only depends on the view the model transforms and the splat set
    if (!m_sortDirty && view == m_lastSortView && transforms == m_lastSortTransforms) return;

    //View-space z of a splat = row 2 of (view * model) dot (position, 1).
    //Computed once per model, then it is a single dot product per splat.
    std::vector<glm::vec4> depthRows;
    depthRows.reserve(transforms.size());
    for (const glm::mat4& m : transforms) {
        glm::mat4 mv = view * m;
        depthRows.emplace_back(mv[0][2], mv[1][2], mv[2][2], mv[3][2]);
    }

    m_sortKeys.resize(m_totalSplatCount);
    for (size_t i = 0; i < m_totalSplatCount; ++i) {
        const SplatVertex& s = m_combined[i];
        m_sortKeys[i] = glm::dot(depthRows[static_cast<size_t>(s.modelID)], glm::vec4(s.position, 1.0f));
    }

    //Camera looks down -z, so farther = more negative z = comes first
    m_sortOrder.resize(m_totalSplatCount);
    std::iota(m_sortOrder.begin(), m_sortOrder.end(), 0u);
    std::sort(m_sortOrder.begin(), m_sortOrder.end(),
        [this](unsigned int a, unsigned int b) { return m_sortKeys[a] < m_sortKeys[b]; });

    //The VAO is bound by caller, this updates its element buffer
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m_ebo);
    glBufferSubData(GL_ELEMENT_ARRAY_BUFFER, 0,
        static_cast<GLsizeiptr>(m_sortOrder.size() * sizeof(unsigned int)), m_sortOrder.data());

    m_lastSortView = view;
    m_lastSortTransforms = std::move(transforms);
    m_sortDirty = false;
}

void SplatRenderer::DrawPointCloud(const glm::mat4& viewProj, float viewportHeightPixels, const glm::vec3& camPos) {

    m_shader->use();
    m_shader->setMat4("uViewProj", viewProj);
    m_shader->setFloat("uPixelsPerUnit", viewportHeightPixels * 0.5f);

    std::vector<glm::mat4> transforms;
    transforms.reserve(m_models.size());
    for (const auto& model : m_models) transforms.push_back(model->GetTransform());
    m_shader->setMat4Array("uModelTransforms", transforms);

    glBindVertexArray(m_vao);

    //Sorting is disabled for now (false)
    if (m_sortEnabled && false) {
        auto t0 = std::chrono::high_resolution_clock::now();

        auto worldPos = [&](unsigned int idx) {
            int mid = static_cast<int>(m_combined[idx].modelID);
            return glm::vec3(m_models[mid]->GetTransform() * glm::vec4(m_combined[idx].position, 1.0f));
            };

        std::vector<unsigned int> order(m_totalSplatCount);
        std::iota(order.begin(), order.end(), 0u);
        std::sort(order.begin(), order.end(), [&](unsigned int a, unsigned int b) {
            glm::vec3 wa = worldPos(a), wb = worldPos(b);
            float distA = glm::dot(wa - camPos, wa - camPos);
            float distB = glm::dot(wb - camPos, wb - camPos);
            return distA > distB;
            });

        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m_ebo);
        glBufferSubData(GL_ELEMENT_ARRAY_BUFFER, 0,
            static_cast<GLsizeiptr>(order.size() * sizeof(unsigned int)), order.data());

        auto t1 = std::chrono::high_resolution_clock::now();
        float ms = std::chrono::duration<float, std::milli>(t1 - t0).count();

        if (ms > kSortBudgetMs) {
            m_framesOverBudget++;
            m_framesUnderBudget = 0;
            if (m_framesOverBudget >= kDisableAfterFrames) {
                m_sortEnabled = false;
                m_framesOverBudget = 0;
            }
        }
        else {
            m_framesOverBudget = 0;
        }

        glDrawElements(GL_POINTS, static_cast<GLsizei>(m_totalSplatCount), GL_UNSIGNED_INT, 0);
    }
    else {
        glDrawArrays(GL_POINTS, 0, static_cast<GLsizei>(m_totalSplatCount)); // failsafe fallback

        m_framesUnderBudget++;
        if (m_framesUnderBudget >= kReEnableAfterFrames) {
            m_sortEnabled = true;
            m_framesUnderBudget = 0;
        }
    }

    glBindVertexArray(0);
}

std::string SplatRenderer::GetModelName(size_t indexNum)
{

    if (indexNum >= m_models.size())
        return std::string();

    return m_models[indexNum].get()->GetName();
}

size_t SplatRenderer::TotalSplatCount() const
{
    size_t count = 0;

    for (const std::unique_ptr<SplatModel>& model : m_models)
        count += model.get()->GetCount();

    return count;
}

size_t SplatRenderer::GetSplatCount(int modelIndex) const
{
    if (modelIndex < 0 || modelIndex >= static_cast<int>(m_models.size()))
        return 0;
    return m_models[modelIndex].get()->GetCount();
}

int SplatRenderer::GetSelectedModel()
{
    return m_selectedModelIndex;
}

void SplatRenderer::SelectModel(int index)
{
    if (index < 0 || index >= static_cast<int>(m_models.size()))
        m_selectedModelIndex = -1;
    else
        m_selectedModelIndex = index;
}

void SplatRenderer::NudgeSplatForward(InputManager& /*manager*/, InputManager::INPUT_TYPE type)
{
    if (m_selectedModelIndex < 0 || m_selectedModelIndex >= static_cast<int>(m_models.size()) || type == InputManager::INPUT_TYPE::RELEASE)
        return;

    m_models[m_selectedModelIndex].get()->Translate({ 0.1,0,0 });
}


void SplatRenderer::NudgeSplatBackwards(InputManager& /*manager*/, InputManager::INPUT_TYPE type)
{
    if (m_selectedModelIndex < 0 || m_selectedModelIndex >= static_cast<int>(m_models.size()) || type == InputManager::INPUT_TYPE::RELEASE)
        return;
    m_models[m_selectedModelIndex].get()->Translate({ -0.1,0,0 });
}

void SplatRenderer::NudgeSplatLeft(InputManager& /*manager*/, InputManager::INPUT_TYPE type)
{
    if (m_selectedModelIndex < 0 || m_selectedModelIndex >= static_cast<int>(m_models.size()) || type == InputManager::INPUT_TYPE::RELEASE)
        return;

    m_models[m_selectedModelIndex].get()->Translate({ 0,0,-0.1 });
}

void SplatRenderer::NudgeSplatRight(InputManager& /*manager*/, InputManager::INPUT_TYPE type)
{
    if (m_selectedModelIndex < 0 || m_selectedModelIndex >= static_cast<int>(m_models.size()) || type == InputManager::INPUT_TYPE::RELEASE)
        return;

    m_models[m_selectedModelIndex].get()->Translate({ 0,0,0.1 });
}


void SplatRenderer::RebuildCombinedBuffer()
{
    m_combined.clear();

    for (size_t modelIdx = 0; modelIdx < m_models.size(); ++modelIdx) {
        const auto& splats = m_models[modelIdx]->splats();
        //Copy, about to mutate modelId
        for (SplatVertex v : splats) { 
            v.modelID = static_cast<float>(modelIdx);
            m_combined.push_back(v);
        }
    }

    m_totalSplatCount = m_combined.size();

    glBindBuffer(GL_ARRAY_BUFFER, m_vbo);
    glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(m_combined.size() * sizeof(SplatVertex)),
        m_combined.data(), GL_STATIC_DRAW);

    glBindVertexArray(m_vao);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m_ebo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, static_cast<GLsizeiptr>(m_combined.size() * sizeof(unsigned int)),
        nullptr, GL_DYNAMIC_DRAW); // reserve space; sort fills it in every frame
    glBindVertexArray(0);

    m_modified = false;
    m_sortDirty = true; //Splat set changed, the cached Gaussian order is stale
}
