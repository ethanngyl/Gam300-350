#include "SplatRenderer.h"

#include <GL/glew.h>

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

} // namespace

SplatRenderer::SplatRenderer() {
    m_shader = std::make_shared<Shader>(kVertexShaderSrc, kFragmentShaderSrc);

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


void SplatRenderer::UpdateModel(SplatModel* model, const std::vector<SplatVertex>& splats) {
    model->SetSplat(splats);
    m_modified = true;
}

void SplatRenderer::TranslateModel(SplatModel* model, const glm::vec3& delta) {
    model->Translate(delta); // no buffer rebuild needed -- transform is GPU-side
}

void SplatRenderer::Draw(const glm::mat4& viewProj, float viewportHeightPixels, const glm::vec3& camPos) {

    if (m_modified) RebuildCombinedBuffer();
    if (m_models.size() == 0) return;

    glDisable(GL_DEPTH_TEST);

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
    glEnable(GL_DEPTH_TEST);
}

std::string SplatRenderer::GetModelName(size_t indexNum)
{

    if (indexNum < 0 || indexNum >= m_totalSplatCount)
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
    if (modelIndex < 0 || modelIndex >= m_totalSplatCount)
        return 0;
    return m_models[modelIndex].get()->GetCount();
}

int SplatRenderer::GetSelectedModel()
{
    return m_selectedModelIndex;
}

void SplatRenderer::SelectModel(int index)
{
    if (index < 0 || index >= m_totalSplatCount)
        m_selectedModelIndex = -1;
    else
        m_selectedModelIndex = index;
}

void SplatRenderer::NudgeSplatForward(InputManager& manager, InputManager::INPUT_TYPE type)
{
    if (m_selectedModelIndex < 0 && m_selectedModelIndex >= m_models.size() && m_models.size() == 0 || type == InputManager::INPUT_TYPE::RELEASE)
        return;

    m_models[m_selectedModelIndex].get()->Translate({ 0.1,0,0 });
}


void SplatRenderer::NudgeSplatBackwards(InputManager& manager, InputManager::INPUT_TYPE type)
{
    if (m_selectedModelIndex < 0 && m_selectedModelIndex >= m_models.size() && m_models.size() == 0 || type == InputManager::INPUT_TYPE::RELEASE)
        return;
    m_models[m_selectedModelIndex].get()->Translate({ -0.1,0,0 });
}

void SplatRenderer::NudgeSplatLeft(InputManager& manager, InputManager::INPUT_TYPE type)
{
    if (m_selectedModelIndex < 0 && m_selectedModelIndex >= m_models.size() && m_models.size() == 0 || type == InputManager::INPUT_TYPE::RELEASE)
        return;

    m_models[m_selectedModelIndex].get()->Translate({ 0,0,-0.1 });
}

void SplatRenderer::NudgeSplatRight(InputManager& manager, InputManager::INPUT_TYPE type)
{
    if (m_selectedModelIndex < 0 && m_selectedModelIndex >= m_models.size() && m_models.size() == 0 || type == InputManager::INPUT_TYPE::RELEASE)
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
}
