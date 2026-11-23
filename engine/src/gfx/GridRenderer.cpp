/******************************************************************************
 * File:        GridRenderer.cpp
 * Project:     Genesis
 *
 * Description:
 * Defines GridRenderer.
 ******************************************************************************/
#include "GridRenderer.h"

#ifdef CODEFINE_GLES
#include <GLES3/gl3.h>
#else
#include <GL/glew.h>
#endif

#include <cmath>
#include <cstddef>
#include <vector>

namespace {

const char* kVertexSrc = R"(
#version 330 core
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
uniform mat4 uViewProj;
out vec4 vColor;
out vec3 vWorld;
void main() {
    vColor = aColor;
    vWorld = aPosition;
    gl_Position = uViewProj * vec4(aPosition, 1.0);
}
)";

const char* kFragmentSrc = R"(
#version 330 core
in vec4 vColor;
in vec3 vWorld;
uniform float uExtent;
out vec4 FragColor;
void main() {
    //Fade towards the edge of the grid so it has no hard border
    float edge = max(abs(vWorld.x), abs(vWorld.z));
    float fade = 1.0 - smoothstep(uExtent * 0.6, uExtent, edge);
    FragColor = vec4(vColor.rgb, vColor.a * fade);
}
)";

struct Vertex {
    glm::vec3 position;
    glm::vec4 color;
};

const glm::vec4 kMinorColor(0.32f, 0.34f, 0.40f, 0.30f);
const glm::vec4 kMajorColor(0.50f, 0.52f, 0.60f, 0.60f);
const glm::vec3 kAxisX(0.95f, 0.30f, 0.30f);
const glm::vec3 kAxisY(0.35f, 0.90f, 0.40f);
const glm::vec3 kAxisZ(0.30f, 0.55f, 1.00f);

void AddLine(std::vector<Vertex>& out, const glm::vec3& a, const glm::vec3& b, const glm::vec4& color) {
    out.push_back({ a, color });
    out.push_back({ b, color });
}

//An axis line through the origin: the positive half bright, the negative half dimmer
void AddAxis(std::vector<Vertex>& out, const glm::vec3& direction, const glm::vec3& color) {
    const float e = GridRenderer::kExtent;
    AddLine(out, glm::vec3(0.0f), direction * e, glm::vec4(color, 0.95f));
    AddLine(out, glm::vec3(0.0f), -direction * e, glm::vec4(color, 0.45f));
}

std::vector<Vertex> BuildGrid() {
    std::vector<Vertex> vertices;
    const float e = GridRenderer::kExtent;
    const int steps = static_cast<int>(std::lround(e / GridRenderer::kMinorStep));
    const int perUnit = static_cast<int>(std::lround(1.0f / GridRenderer::kMinorStep));

    for (int i = -steps; i <= steps; ++i) {
        if (i == 0) continue; //The axes are drawn there instead
        const float c = static_cast<float>(i) * GridRenderer::kMinorStep;
        const glm::vec4& color = (i % perUnit == 0) ? kMajorColor : kMinorColor;
        AddLine(vertices, glm::vec3(-e, 0.0f, c), glm::vec3(e, 0.0f, c), color); //Parallel to X
        AddLine(vertices, glm::vec3(c, 0.0f, -e), glm::vec3(c, 0.0f, e), color); //Parallel to Z
    }

    AddAxis(vertices, glm::vec3(1.0f, 0.0f, 0.0f), kAxisX);
    AddAxis(vertices, glm::vec3(0.0f, 1.0f, 0.0f), kAxisY);
    AddAxis(vertices, glm::vec3(0.0f, 0.0f, 1.0f), kAxisZ);
    return vertices;
}

}

GridRenderer::GridRenderer()
{
    m_shader = std::make_unique<Shader>(kVertexSrc, kFragmentSrc);

    const std::vector<Vertex> vertices = BuildGrid();
    m_vertexCount = static_cast<int>(vertices.size());

    glGenVertexArrays(1, &m_vao);
    glGenBuffers(1, &m_vbo);

    glBindVertexArray(m_vao);
    glBindBuffer(GL_ARRAY_BUFFER, m_vbo);
    glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(vertices.size() * sizeof(Vertex)), vertices.data(), GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex),
                          reinterpret_cast<const void*>(offsetof(Vertex, position)));
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, sizeof(Vertex),
                          reinterpret_cast<const void*>(offsetof(Vertex, color)));
    glBindVertexArray(0);
}

GridRenderer::~GridRenderer()
{
    glDeleteBuffers(1, &m_vbo);
    glDeleteVertexArrays(1, &m_vao);
}

void GridRenderer::Draw(const glm::mat4& viewProj)
{
    m_shader->use();
    m_shader->setMat4("uViewProj", viewProj);
    m_shader->setFloat("uExtent", kExtent);

    glEnable(GL_DEPTH_TEST);
    glDepthMask(GL_FALSE);
    glBindVertexArray(m_vao);
    glDrawArrays(GL_LINES, 0, m_vertexCount);
    glBindVertexArray(0);
    glDepthMask(GL_TRUE);
}
