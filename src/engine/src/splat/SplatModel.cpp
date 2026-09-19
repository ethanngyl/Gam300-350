#include "SplatModel.h"

#include <GL/glew.h>

#include <cstddef>

SplatModel::SplatModel(std::shared_ptr<Shader> shader) : m_shader(shader)
{
    //Alloclate the vao/vbo buffers
    glGenVertexArrays(1, &m_vao);
    glGenBuffers(1, &m_vbo);

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

    ///Unbinds the vao but setting it to 0
    glBindVertexArray(0);
}

SplatModel::~SplatModel()
{
    if (m_vbo) glDeleteBuffers(1, &m_vbo);
    if (m_vao) glDeleteVertexArrays(1, &m_vao);
}

void SplatModel::SetSplat(const std::vector<SplatVertex>& splats)
{
    m_count = splats.size();
    m_splats = splats;

    glBindBuffer(GL_ARRAY_BUFFER, m_vbo);
    glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(splats.size() * sizeof(SplatVertex)),
        splats.data(), GL_STATIC_DRAW);
}

void SplatModel::Draw(const glm::mat4& viewProj, float viewportHeightPixels) const
{
    if (m_count == 0) return;
    glDisable(GL_DEPTH_TEST);

    m_shader->use();
    m_shader->setMat4("uViewProj", viewProj);
    // Empirical scale so world-space splat radii map to a reasonable pixel size.
    m_shader->setFloat("uPixelsPerUnit", viewportHeightPixels * 0.5f);

    glBindVertexArray(m_vao);
    glDrawArrays(GL_POINTS, 0, static_cast<GLsizei>(m_count));
    glBindVertexArray(0);

    glEnable(GL_DEPTH_TEST);
}
