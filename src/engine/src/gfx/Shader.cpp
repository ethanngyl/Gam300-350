#include "Shader.h"

#include <GL/glew.h>
#include <glm/gtc/type_ptr.hpp>

#include <iostream>
#include <vector>

namespace {

unsigned int compileStage(unsigned int type, const char* src) {
    unsigned int shader = glCreateShader(type);
    glShaderSource(shader, 1, &src, nullptr);
    glCompileShader(shader);

    int success = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &success);
    if (!success) {
        int len = 0;
        glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &len);
        std::vector<char> log(len > 0 ? static_cast<size_t>(len) : 1);
        glGetShaderInfoLog(shader, len, nullptr, log.data());
        std::cerr << "[Shader] compile error: " << log.data() << std::endl;
    }
    return shader;
}

} // namespace

Shader::Shader(const char* vertexSrc, const char* fragmentSrc) {
    unsigned int vs = compileStage(GL_VERTEX_SHADER, vertexSrc);
    unsigned int fs = compileStage(GL_FRAGMENT_SHADER, fragmentSrc);

    m_id = glCreateProgram();
    glAttachShader(m_id, vs);
    glAttachShader(m_id, fs);
    glLinkProgram(m_id);

    int success = 0;
    glGetProgramiv(m_id, GL_LINK_STATUS, &success);
    if (!success) {
        int len = 0;
        glGetProgramiv(m_id, GL_INFO_LOG_LENGTH, &len);
        std::vector<char> log(len > 0 ? static_cast<size_t>(len) : 1);
        glGetProgramInfoLog(m_id, len, nullptr, log.data());
        std::cerr << "[Shader] link error: " << log.data() << std::endl;
    }

    glDeleteShader(vs);
    glDeleteShader(fs);
}

Shader::~Shader() {
    if (m_id != 0) {
        glDeleteProgram(m_id);
    }
}

void Shader::use() const {
    glUseProgram(m_id);
}

void Shader::setMat4(const std::string& name, const glm::mat4& value) const {
    glUniformMatrix4fv(glGetUniformLocation(m_id, name.c_str()), 1, GL_FALSE, glm::value_ptr(value));
}

void Shader::setFloat(const std::string& name, float value) const {
    glUniform1f(glGetUniformLocation(m_id, name.c_str()), value);
}

void Shader::setVec3(const std::string& name, const glm::vec3& value) const {
    glUniform3fv(glGetUniformLocation(m_id, name.c_str()), 1, glm::value_ptr(value));
}
