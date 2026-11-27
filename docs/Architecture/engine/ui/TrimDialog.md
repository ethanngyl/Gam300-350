# `ui/TrimDialog.h` / `TrimDialog.cpp`

A non-modal window for editing the **default** splat trim values ([splat/SplatTrimmer](../splat/SplatTrimmer.md)). *Apply* saves them as the global defaults used for later imports. It does **not** change models already in the scene; per-model trimming is in the [Inspector](InspectorPanel.md).

## Controls
| Label | Widget | Range | Maps to |
|---|---|---|---|
| Min opacity | `QDoubleSpinBox`, 3 decimals, step 0.005 | 0 – 1 | `TrimData::minAlpha` |
| Edge crop | `QDoubleSpinBox`, 2 decimals, step 0.05, suffix `%` | 0 – 20 | `cropPct` |
| Density grid | `QSpinBox` | 0 – 1000 | `voxelDivisions` (0 = off) |
| Min splats per cell | `QSpinBox` | 1 – 100 | `minPerVoxel` (1 = off) |

## Functions

### `TrimDialog(const TrimData& initial, ApplyCallback onApply, QWidget* parent)`
Builds an intro label, the form, and an **Apply / Restore Defaults / Close** button box.
- **Apply** calls `m_onApply(current())`.
- **Restore Defaults** calls `load(TrimData{})`, which loads the factory defaults into the form without applying them.
- **Close** closes the window.

It then calls `load(initial)`.

### `void load(const TrimData&)` *(private)*
Copies the values into the spin boxes.

### `TrimData current() const` *(private)*
Reads the spin boxes back into a `TrimData`.
