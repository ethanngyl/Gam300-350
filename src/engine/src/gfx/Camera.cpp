#include "Camera.h"

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <cmath>

Camera::Camera(glm::vec3 target, float distance)
    : m_target(target)
    , m_distance(distance)
    , m_yaw(0.0f)
    , m_pitch(0.3f) {
}

void Camera::processDrag(double dx, double dy) {
    constexpr float kSensitivity = 0.005f;
    m_yaw += static_cast<float>(dx) * kSensitivity;
    m_pitch += static_cast<float>(dy) * kSensitivity;
    m_pitch = std::clamp(m_pitch, -kPitchLimit, kPitchLimit);
}

void Camera::processScroll(double dy) {
    constexpr float kZoomSpeed = 0.2f;
    m_distance -= static_cast<float>(dy) * m_distance * kZoomSpeed;
    m_distance = std::clamp(m_distance, kMinDistance, kMaxDistance);
}

glm::vec3 Camera::getPosition() const {
    float x = m_distance * std::cos(m_pitch) * std::sin(m_yaw);
    float y = m_distance * std::sin(m_pitch);
    float z = m_distance * std::cos(m_pitch) * std::cos(m_yaw);
    return m_target + glm::vec3(x, y, z);
}

glm::mat4 Camera::getView() const {
    return glm::lookAt(getPosition(), m_target, glm::vec3(0.0f, 1.0f, 0.0f));
}

glm::mat4 Camera::getProjection(float aspect) const {
    return glm::perspective(glm::radians(m_fovYDegrees), aspect, m_nearPlane, m_farPlane);
}
