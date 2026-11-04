/******************************************************************************
 * File:        CropBoxRenderer.cpp
 * Project:     Genesis
 *
 * Description:
 * Defines CropBoxRenderer.
 ******************************************************************************/
#include "CropBoxRenderer.h"

#ifdef CODEFINE_GLES
#include <GLES3/gl3.h>
#else
#include <GL/glew.h>
#endif

namespace {

const char* kVertexSrc = R"(
#version 330 core
layout(location = 0) in vec3 aPosition;
uniform mat4 uViewProj;
uniform mat4 uModel;
void main() {
    gl_Position = uViewProj * uModel * vec4(aPosition, 1.0);
}
)";

const char* kFragmentSrc = R"(
#version 330 core
uniform vec3 uColor;
out vec4 FragColor;
void main() {
    FragColor = vec4(uColor, 0.95);
}
)";

//Unit cube centred on the origin
const float kCorners[8 * 3] = {
    -0.5f, -0.5f, -0.5f,
     0.5f, -0.5f, -0.5f,
     0.5f,  0.5f, -0.5f,
    -0.5f,  0.5f, -0.5f,
    -0.5f, -0.5f,  0.5f,
     0.5f, -0.5f,  0.5f,
     0.5f,  0.5f,  0.5f,
    -0.5f,  0.5f,  0.5f,
};

//12 edges two corners each
const unsigned short kEdges[24] = {
    0, 1,  1, 2,  2, 3,  3, 0, //Back face
    4, 5,  5, 6,  6, 7,  7, 4, //Front face
    0, 4,  1, 5,  2, 6,  3, 7, //Connecting edges
};

}

CropBoxRenderer::CropBoxRenderer()
{
    m_shader = std::make_unique<Shader>(kVertexSrc, kFragmentSrc);

    glGenVertexArrays(1, &m_vao);
    glGenBuffers(1, &m_vbo);
    glGenBuffers(1, &m_ebo);

    glBindVertexArray(m_vao);
    glBindBuffer(GL_ARRAY_BUFFER, m_vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(kCorners), kCorners, GL_STATIC_DRAW);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m_ebo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(kEdges), kEdges, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 3 * sizeof(float), nullptr);
    glBindVertexArray(0);
}

CropBoxRenderer::~CropBoxRenderer()
{
    glDeleteBuffers(1, &m_ebo);
    glDeleteBuffers(1, &m_vbo);
    glDeleteVertexArrays(1, &m_vao);
}

void CropBoxRenderer::Draw(const glm::mat4& viewProj, const glm::mat4& boxTransform, const glm::vec3& color)
{
    m_shader->use();
    m_shader->setMat4("uViewProj", viewProj);
    m_shader->setMat4("uModel", boxTransform);
    m_shader->setVec3("uColor", color);

    glDisable(GL_DEPTH_TEST);
    glBindVertexArray(m_vao);
    glDrawElements(GL_LINES, 24, GL_UNSIGNED_SHORT, nullptr);
    glBindVertexArray(0);
    glEnable(GL_DEPTH_TEST);
}
