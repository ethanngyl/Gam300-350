# `gfx/Camera.h` / `Camera.cpp`

An **orbit camera**: it circles a target point at a variable distance, using yaw and pitch angles. The desktop editor drives it through `InputManager` callbacks. The web build has no InputManager, so it calls the raw `Orbit`/`Pan`/`Zoom` functions directly.

## State and constants

| Member | Default | Meaning |
|---|---|---|
| `m_target` / `m_orginalTarget` | constructor arg | Point the camera looks at, and a copy kept for reset. |
| `m_distance` | 3.0 | Distance from the target, clamped to `[0.5, 50]`. |
| `m_yaw`, `m_pitch` | 0, 0.3 rad | Spherical angles. Pitch is clamped to ±1.55 rad, just under π/2, so the camera never flips over the pole. |
| FOV / near / far | 45°, 0.05, 100 | Projection parameters. |
| `m_RotateSensitivity` | 0.005 rad/px | Orbit speed. |
| `m_ZoomSpeed` | 0.2 | Fraction of the current distance moved per wheel notch. |
| `m_PanSensitivity` | 0.0005 | Pan speed, scaled by distance. |

## Functions

### `Camera(glm::vec3 target = 0, float distance = 3)`
Saves the target twice (current and original) and the distance, and sets yaw 0 and pitch 0.3.

### Input callbacks
- `ProcessLeftClick(InputManager&, INPUT_TYPE)` calls `Pan(dx, dy)` with the manager's mouse delta.
- `ProcessRightClick(...)` calls `Orbit(dx, dy)`.
- `ProcessScroll(...)` calls `Zoom(scrollY)`.

### `void Orbit(float dx, float dy)`
`yaw -= dx * sensitivity` and `pitch += dy * sensitivity`, then clamps the pitch.

### `void Pan(float dx, float dy)`
Builds the camera basis from the current position: `forward = normalize(target - position)`, `right = normalize(forward × worldUp)`, `up = right × forward`. It then moves the **target** by `(-right·dx + up·dy) · panSensitivity · distance`. Scaling by distance keeps the pan speed in screen space about the same at any zoom.

### `void Zoom(float scrollY)`
`distance -= scrollY * distance * zoomSpeed`, which is multiplicative, so zoom feels the same near and far. The result is clamped to `[0.5, 50]`.

### `glm::vec3 getPosition() const`
Converts spherical to Cartesian, relative to the target:
`x = d·cos(pitch)·sin(yaw)`, `y = d·sin(pitch)`, `z = d·cos(pitch)·cos(yaw)`.

### `glm::mat4 getView() const`
Returns `glm::lookAt(getPosition(), target, (0,1,0))`.

### `glm::mat4 getProjection(float aspect) const`
Returns `glm::perspective(45°, aspect, 0.05, 100)`.

### `void ResetPosition()`
Moves the target back to the original target. Angles and distance stay as they are.

### `void ResetSensivity()`
Sets the rotate, zoom and pan sensitivities back to their defaults.
