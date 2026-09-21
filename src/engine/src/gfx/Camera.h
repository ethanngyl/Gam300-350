#pragma once

#include <glm/glm.hpp>

// Simple orbit camera: rotates around a fixed target at a variable distance.
class Camera {
public:
    explicit Camera(glm::vec3 target = glm::vec3(0.0f), float distance = 3.0f);

    void processDrag(double dx, double dy);
    void processScroll(double dy);
    void processPan(double dx, double dy);

    glm::mat4 getView() const;
    glm::mat4 getProjection(float aspect) const;
    glm::vec3 getPosition() const;

    void ResetPosition();
    void ResetSensivity();


private:
    glm::vec3 m_orginalTarget; //Default target on constuct, used for reset
    glm::vec3 m_target;
    float m_distance;
    float m_yaw;   // radians
    float m_pitch; // radians, clamped to avoid gimbal flip

    float m_fovYDegrees = 45.0f;
    float m_nearPlane = 0.05f;
    float m_farPlane = 100.0f;

    static constexpr float m_MinDistance = 0.5f;
    static constexpr float m_MaxDistance = 50.0f;
    static constexpr float m_PitchLimit = 1.55f; // just under pi/2

    //Default Modifiers
    const float m_OrginalRotateSensitivity = 0.005f;
    const float m_OrginalZoomSpeed = 0.2f;
    const float m_OrginalPanSensitivity = 0.0005f;

    //Modifiers
    float m_RotateSensitivity = 0.005f;
    float m_ZoomSpeed = 0.2f;
    float m_PanSensitivity = 0.0005f;

};
