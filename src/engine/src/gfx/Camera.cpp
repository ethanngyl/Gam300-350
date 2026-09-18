#include "Camera.h"

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <cmath>

Camera::Camera(glm::vec3 target, float distance)
    : m_target(target)
    , m_orginalTarget(target)
    , m_distance(distance)
    , m_yaw(0.0f)
    , m_pitch(0.3f) {
}

void Camera::processDrag(double dx, double dy) {
    m_yaw -= static_cast<float>(dx) * m_RotateSensitivity;
    m_pitch += static_cast<float>(dy) * m_RotateSensitivity;
    m_pitch = std::clamp(m_pitch, -m_PitchLimit, m_PitchLimit);
}

void Camera::processScroll(double dy) {
    m_distance -= static_cast<float>(dy) * m_distance * m_ZoomSpeed;
    m_distance = std::clamp(m_distance, m_MinDistance, m_MaxDistance);
}

void Camera::processPan(double dx, double dy)
{
    glm::vec3 forward = glm::normalize(m_target - getPosition());
    glm::vec3 right = glm::normalize(glm::cross(forward, glm::vec3(0.0f, 1.0f, 0.0f)));
    glm::vec3 up = glm::cross(right, forward);
    glm::vec3 delta = (-right * static_cast<float>(dx) + up * static_cast<float>(dy)) * m_PanSensitivity * m_distance;
    m_target += delta;
}

glm::vec3 Camera::getPosition() const {
    float x = m_distance * std::cos(m_pitch) * std::sin(m_yaw);
    float y = m_distance * std::sin(m_pitch);
    float z = m_distance * std::cos(m_pitch) * std::cos(m_yaw);
    return m_target + glm::vec3(x, y, z);
}

void Camera::ResetPosition()
{
    m_target = m_orginalTarget;
}

void Camera::ResetSensivity()
{
    m_RotateSensitivity = m_OrginalRotateSensitivity;
    m_ZoomSpeed = m_OrginalZoomSpeed;
    m_PanSensitivity = m_OrginalPanSensitivity;
}

glm::mat4 Camera::getView() const {
    return glm::lookAt(getPosition(), m_target, glm::vec3(0.0f, 1.0f, 0.0f));
}

glm::mat4 Camera::getProjection(float aspect) const {
    return glm::perspective(glm::radians(m_fovYDegrees), aspect, m_nearPlane, m_farPlane);
}
