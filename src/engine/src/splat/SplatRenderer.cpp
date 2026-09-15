#include "SplatRenderer.h"

#include <GL/glew.h>

#include <cstddef>

namespace {

const char* kVertexShaderSrc = R"(
#version 330 core
layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aPointSize;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aAlpha;

uniform mat4 uViewProj;
uniform float uPixelsPerUnit;

out vec3 vColor;
out float vAlpha;

void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    gl_Position = uViewProj * vec4(aPosition, 1.0);
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
    m_shader = std::make_unique<Shader>(kVertexShaderSrc, kFragmentShaderSrc);

    glGenVertexArrays(1, &m_vao);
    glGenBuffers(1, &m_vbo);

    glBindVertexArray(m_vao);
    glBindBuffer(GL_ARRAY_BUFFER, m_vbo);

    glEnableVertexAttribArray(0);
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

    glBindVertexArray(0);
}

SplatRenderer::~SplatRenderer() {
    if (m_vbo) glDeleteBuffers(1, &m_vbo);
    if (m_vao) glDeleteVertexArrays(1, &m_vao);
}

void SplatRenderer::setSplats(const std::vector<SplatVertex>& splats) {
    m_count = splats.size();

    glBindBuffer(GL_ARRAY_BUFFER, m_vbo);
    glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(splats.size() * sizeof(SplatVertex)),
        splats.data(), GL_STATIC_DRAW);
}

void SplatRenderer::draw(const glm::mat4& viewProj, float viewportHeightPixels) const {
    if (m_count == 0) return;

    m_shader->use();
    m_shader->setMat4("uViewProj", viewProj);
    // Empirical scale so world-space splat radii map to a reasonable pixel size.
    m_shader->setFloat("uPixelsPerUnit", viewportHeightPixels * 0.5f);

    glBindVertexArray(m_vao);
    glDrawArrays(GL_POINTS, 0, static_cast<GLsizei>(m_count));
    glBindVertexArray(0);
}
