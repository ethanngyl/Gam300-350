#pragma once

#include <glm/glm.hpp>

// Simple orbit camera: rotates around a fixed target at a variable distance.
class Camera {
public:
    explicit Camera(glm::vec3 target = glm::vec3(0.0f), float distance = 3.0f);

    void processDrag(double dx, double dy);
    void processScroll(double dy);

    glm::mat4 getView() const;
    glm::mat4 getProjection(float aspect) const;
    glm::vec3 getPosition() const;

private:
    glm::vec3 m_target;
    float m_distance;
    float m_yaw;   // radians
    float m_pitch; // radians, clamped to avoid gimbal flip

    float m_fovYDegrees = 45.0f;
    float m_nearPlane = 0.05f;
    float m_farPlane = 100.0f;

    static constexpr float kMinDistance = 0.5f;
    static constexpr float kMaxDistance = 50.0f;
    static constexpr float kPitchLimit = 1.55f; // just under pi/2
};
