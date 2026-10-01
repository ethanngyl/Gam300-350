#pragma once

#include <glm/glm.hpp>
#include <string>
#include <vector>

class Shader {
public:
    Shader(const char* vertexSrc, const char* fragmentSrc);
    ~Shader();

    Shader(const Shader&) = delete;
    Shader& operator=(const Shader&) = delete;

    void use() const;

    void setMat4(const std::string& name, const glm::mat4& value) const;
    void setMat4Array(const std::string& name, const std::vector<glm::mat4>& values) const;
    void setFloat(const std::string& name, float value) const;
    void setVec3(const std::string& name, const glm::vec3& value) const;

    unsigned int id() const { return m_id; }

private:
    unsigned int m_id = 0;
};
