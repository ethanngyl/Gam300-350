/******************************************************************************
 * File:        Shader.h
 * Project:     Genesis
 * Author(s):	Ethan Ng Yong Le   (Primary, 100%)
 *
 * Description:
 * This file contains the definition for the class Shader
 * It handles the setting values for the shader
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#include "Shader.h"

#ifdef CODEFINE_GLES
#include <GLES3/gl3.h>
#else
#include <GL/glew.h>
#endif
#include <glm/gtc/type_ptr.hpp>

#include <iostream>
#include <string>
#include <vector>

namespace {

#ifdef CODEFINE_GLES
//Shaders are written as desktop "#version 330 core". WebGL2 / GLES3 takes the same
//language under a different header plus default precisions, so swap the header line.
//GLES also requires #version on the very first line, so drop anything before it (the
//raw string literals start with a newline).
std::string translateForGles(const char* src) {
    std::string out(src);
    const std::string desktop = "#version 330 core";
    size_t pos = out.find(desktop);
    if (pos != std::string::npos) {
        out.replace(0, pos + desktop.size(),
            "#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;");
    }
    return out;
}
#endif

unsigned int compileStage(unsigned int type, const char* src) {
#ifdef CODEFINE_GLES
    std::string translated = translateForGles(src);
    src = translated.c_str();
#endif
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

Shader::Shader(const char* vertexSrc, const char* fragmentSrc)
    : Shader(vertexSrc, nullptr, fragmentSrc) {
}

Shader::Shader(const char* vertexSrc, const char* geometrySrc, const char* fragmentSrc) {
    unsigned int vs = compileStage(GL_VERTEX_SHADER, vertexSrc);
#ifdef CODEFINE_GLES
    //GLES3 has no geometry stage; the renderer never passes one on this build
    (void)geometrySrc;
    unsigned int gs = 0;
#else
    unsigned int gs = geometrySrc ? compileStage(GL_GEOMETRY_SHADER, geometrySrc) : 0;
#endif
    unsigned int fs = compileStage(GL_FRAGMENT_SHADER, fragmentSrc);

    m_id = glCreateProgram();
    glAttachShader(m_id, vs);
    if (gs) glAttachShader(m_id, gs);
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
    if (gs) glDeleteShader(gs);
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

void Shader::setMat4Array(const std::string& name, const std::vector<glm::mat4>& values) const {
    for (size_t i = 0; i < values.size(); ++i) {
        setMat4(name + "[" + std::to_string(i) + "]", values[i]);
    }
}


void Shader::setFloat(const std::string& name, float value) const {
    glUniform1f(glGetUniformLocation(m_id, name.c_str()), value);
}

void Shader::setInt(const std::string& name, int value) const {
    glUniform1i(glGetUniformLocation(m_id, name.c_str()), value);
}

void Shader::setVec2(const std::string& name, const glm::vec2& value) const {
    glUniform2fv(glGetUniformLocation(m_id, name.c_str()), 1, glm::value_ptr(value));
}

void Shader::setVec3(const std::string& name, const glm::vec3& value) const {
    glUniform3fv(glGetUniformLocation(m_id, name.c_str()), 1, glm::value_ptr(value));
}
