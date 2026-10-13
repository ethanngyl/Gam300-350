/******************************************************************************
 * File:        Shader.h
 * Project:     Genesis
 * Author(s):	Ethan Ng Yong Le        (Primary, 90%) - Created base class and functions
 *              Clement Ang Yang Ying   (Secondary, 10%) - Added additional functions and modified existing functions
 * 
 * Description:
 * This file contains the declaration for the class Shader
 * It handles the setting values for the shader
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#pragma once

#include <glm/glm.hpp>
#include <string>
#include <vector>

class Shader {
public:
    Shader(const char* vertexSrc, const char* fragmentSrc);
    //With extra geometry stage (pass nullptr to skip it)
    Shader(const char* vertexSrc, const char* geometrySrc, const char* fragmentSrc);
    ~Shader();

    Shader(const Shader&) = delete;
    Shader& operator=(const Shader&) = delete;

    void use() const;

    void setMat4(const std::string& name, const glm::mat4& value) const;
    void setMat4Array(const std::string& name, const std::vector<glm::mat4>& values) const;
    void setFloat(const std::string& name, float value) const;
    void setVec2(const std::string& name, const glm::vec2& value) const;
    void setVec3(const std::string& name, const glm::vec3& value) const;

    unsigned int id() const { return m_id; }

private:
    unsigned int m_id = 0;
};
