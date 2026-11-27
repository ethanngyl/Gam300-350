# `splat/SplatGenerator.h` / `SplatGenerator.cpp`

*Author: Clement.* Procedural splat generators for **stress testing** the engine (loading, selecting, moving and deleting) with large splat counts. Used by [Manager/StressTestRunner](../Manager/StressTestRunner.md) and the *Generate test sphere* action.

## `constexpr size_t kStressTestSplatCount = 1'000'000`
The default size of the test sphere.

## `std::vector<SplatVertex> splat_generate::GenerateSphereSplats(size_t count = 1e6, float radius = 1, glm::vec3 center = 0)`
Spreads `count` splats evenly over the surface of a sphere using a **Fibonacci lattice**:
- `goldenAngle = π(3 − √5)`.
- For splat `i`: `y = 1 − 2(i + 0.5)/count` (top to bottom), ring radius `√(1 − y²)`, `θ = goldenAngle · i`, and `normal = (ring·cosθ, y, ring·sinθ)`.
- Position: `center + normal · radius`.
- **Size:** the average spacing between points is `√(4πr² / count)` (surface area divided by count). Each splat's `pointSize` and uniform `scale` are half of that, so neighbours just overlap and the surface reads as solid.
- **Colour:** the normal remapped to 0…1, so you can see the orientation when the sphere is moved or rotated.
- Alpha 1, identity rotation, `modelID` 0.

It returns an empty vector for `count == 0` or `radius ≤ 0`.
