/******************************************************************************
 * File:        SplatModel.h
 * Project:     Genesis
 * Author(s):	Clement Ang Yang Ying   (Primary, 100%) - Created class and logic
 *
 * Description:
 * This file contains the definition & declaration for the class SplatModel
 * This class stores the model data and has functions to modify them.
 *
 * Copyright 2026 DigiPen Institute of Technology Singapore.
 * All rights reserved.
 ******************************************************************************/
#pragma once

#include "SplatData.h"
#include "SplatTrimmer.h"
#include "../gfx/Shader.h"
#include <glm/gtc/matrix_transform.hpp>

#include <memory>
#include <vector>
#include <string>


class SplatModel
{
public:
    void SetSplat(const std::vector<SplatVertex>& splats) { m_splats = splats; }
    const std::vector<SplatVertex>& splats() const { return m_splats; }
    size_t GetCount() const { return m_splats.size(); }

    //Untrimmed data, kept so the model can be re-trimmed with different settings.
    //Empty until the model is first trimmed; SourceSplats() falls back to the current data.
    void SetOriginal(std::vector<SplatVertex>&& original) { m_original = std::move(original); }
    void KeepOriginal() { if (m_original.empty()) m_original = m_splats; }
    const std::vector<SplatVertex>& SourceSplats() const { return m_original.empty() ? m_splats : m_original; }

    //Trim values this model was last trimmed with (or will start from if never trimmed),
    //and whether it has been trimmed at all.
    void SetTrimData(const TrimData& data, bool trimmed) { m_trimData = data; m_trimmed = trimmed; }
    const TrimData& GetTrimData() const { return m_trimData; }
    bool IsTrimmed() const { return m_trimmed; }

    void SetName(const std::string& name) { m_name = name; }
    const std::string& GetName() const { return m_name; }

    void SetTransform(const glm::mat4& t) { m_transform = t; }
    const glm::mat4& GetTransform() const { return m_transform; }
    void Translate(const glm::vec3& delta) { m_transform = glm::translate(m_transform, delta); }

    //Use SplatRenderer::SetModelHidden to change this, so the draw buffer gets rebuilt
    void SetHidden(bool hidden) { isHidden = hidden; }
    bool GetIsHidden() const { return isHidden; }

private:
    unsigned int m_vao = 0; //Vertex Buffer Object
    unsigned int m_vbo = 0; //Vertex Array Object
    size_t m_count = 0;
    std::shared_ptr<Shader> m_shader; //Shared pointer to the shader

    glm::mat4 m_transform = glm::mat4(1);
    std::string m_name;
    std::vector<SplatVertex> m_splats; //Copy of splat data
    std::vector<SplatVertex> m_original; //Untrimmed copy, empty if the model was never trimmed

    TrimData m_trimData; //Values used for the last trim
    bool m_trimmed = false; //If the model has been trimmed

    bool isHidden = false; //If model is currently hhidden
};