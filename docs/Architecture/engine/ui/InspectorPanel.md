# `ui/InspectorPanel.h` / `InspectorPanel.cpp`

The contents of the editor's **Inspector** dock: the properties of the selected model (name, splat count, position, rotation and scale), the **Crop Box** controls and the per-model **Trim** values. The panel **never applies edits itself**. It emits signals with before/after values, and MainWindow pushes them as undoable commands. `syncFromModel()` pulls changes made elsewhere (gizmo, nudges, undo) back into the fields.

## Layout
`QStackedWidget`, page 0 is *"Select a model in the Scene panel…"*. Page 1 has these sections:
- **Model:** a Name field and a Splats count.
- **Transform:** Position, Rotation and Scale rows, each with X/Y/Z spin boxes whose labels are coloured red, green and blue. All have `keyboardTracking(false)`, so values apply on Enter, focus loss or the arrow keys rather than on every keystroke. Below them, a *Reset Position* button.
- **Crop Box:** a *Show/Hide Crop Box* toggle (Ctrl+B), a *Mode: Crop / Mode: Move* toggle (Ctrl+Shift+B), *Cut Inside* / *Cut Outside* as an exclusive pair, and an action button (*Remove Splats*, *Confirm Selection* or *Release Selection*; Enter in the viewport does the same).
- **Trim:** Min opacity, Edge crop %, Density grid, Min per cell and a Status line, plus *Untrim*, *Defaults* and *Apply*.
- A tip that WASD and the arrow keys nudge the model.

## Ranges
Position ±1000, step 0.1 (the same as a nudge), 3 decimals. Rotation ±360°, step 1, 2 decimals. Scale 0.001–1000, step 0.1. **Scale never reaches 0**, because it is read back as the length of each matrix column, and a zero-length column has no direction left to rebuild it from.

## Helpers (anonymous namespace)
- **`ExtractRotation(transform, mat3&)`**: runs **Gram–Schmidt** on the axis columns in X, Y, Z order. For a rotation-plus-scale matrix this gives the rotation exactly; any shear is left out, so the result is always a clean rotation. It returns false if an axis has collapsed.
- **`RotationFromDegrees(vec3)`**: `mat3_cast(quat(radians(deg)))`. This is the exact inverse of `eulerAngles(quat)`, so the fields and the matrix use one convention.
- **`MaxDifference(a, b)`**: the largest difference between any two matching entries of two `mat3`s.

## Public functions

### `InspectorPanel(QWidget* parent)`
Builds everything and connects:
- **Position spins:** `writePosition()`. **Rotation spin i:** `writeRotation(i)`. **Scale spin i:** `writeScale(i)`.
- **Name `editingFinished`:** emits `nameChanged(trimmed)` only if the name is not empty and actually changed. A blank name is reverted.
- **Crop toggle:** `cropBoxToggled(on)`. **Cut buttons:** `cropModeSelected(0|1)`. **Mode toggle:** `cropModeSelected(CropMoveContents)`, or back to the remembered cut side. **Action button:** `cropApplyRequested()`.
- **Apply:** `trimApplyRequested(currentTrim())`. **Untrim:** `untrimRequested()`. **Defaults:** fills the fields from `m_defaultTrim` without applying them.
- **Reset Position:** `resetPositionRequested()`. MainWindow's action does the work, so the button and the menu item cannot drift apart.

It finishes with `setModel(nullptr)`.

### `void setModel(SplatModel*)`
Sets which model is inspected (`nullptr` means nothing). It switches pages, fills in the name with signals blocked, the splat count and the trim fields, and calls `syncFromModel()`. The pointer **must be reset before the model is destroyed**.

### `void setDefaultTrim(const TrimData&)`
The global defaults that the *Defaults* button fills in.

### `void refreshTrim()`
Reloads the splat count and trim fields and status after the model was trimmed again.

### `void syncFromModel()`
Cheap enough to call **every frame**.
- **Position:** the matrix's 4th column. Each field is updated only if it **does not have focus** and differs by more than half the last displayed decimal, so float noise never causes a refresh.
- **Rotation:** only when no rotation field has focus. Several Euler triples describe the same orientation (Y = 120 can come back as X = 180, Y = 60, Z = 180), so the fields are rewritten **only when they no longer describe the model** (difference above 1e-3). Otherwise they would jump while being edited. The shown angles are saved in `m_shownRotation`.
- **Scale:** each column's length, with the same focus and tolerance rules. A scale below 0.001 shows as 0.001.

### `void setCropState(bool active, bool moveContents, bool removeInside, bool confirmed)`
Called every frame, but it **does nothing if the state has not changed** (cached in `m_crop*`). It updates the toggle's checked state and text, the checked and enabled state of the cut buttons (disabled in Move mode, though the cut side is remembered), the mode text and tooltip, and the action button's text and enabled state (enabled only while the box is shown). A `static_assert` ties the cut button ids to the `CropMode` values.

## Private functions

### `void writePosition()`
Copies the transform, replaces the translation column with the field values, and emits `transformFieldEdited(model, before, after)` if anything changed.

### `void writeRotation(int editedAxis)`
1. Extracts the current rotation and returns if any axis has collapsed.
2. **Only the edited field is trusted.** It starts from `m_shownRotation` if those angles still describe the model, otherwise from angles read back from the matrix (after a gizmo move or an undo). Always reading from the matrix would mix angle sets and flip the model.
3. Replaces the edited angle, writes the others back with signals blocked, and updates `m_shownRotation`.
4. If the wanted rotation already matches (within 1e-4), it does nothing.
5. Computes `turn = wanted · currentᵀ` and multiplies **every axis column** by it. This keeps each column's length (the scale) and any shear. Writing the wanted directions straight into the columns would flatten the matrix to orthonormal. The translation is untouched. Then it emits `transformFieldEdited`.

### `void writeScale(int editedAxis)`
Changes **only the edited column**: same direction, new length. It skips collapsed columns and edits that are below display precision. The other fields are not read, because the spin box clamps them, and a value such as 0.0001 from the gizmo would otherwise be snapped to 0.001. Then it emits `transformFieldEdited`.

### `void loadTrim()` / `void loadTrimFields(const TrimData&)` / `TrimData currentTrim() const`
`loadTrim` fills the fields from the model's `TrimData`, enables *Untrim* only if the model is trimmed, and shows *"Kept X of Y"* or *"Not trimmed"*. `loadTrimFields` sets the four spin boxes with signals blocked. `currentTrim` reads them back.

## Signals
`cropBoxToggled(bool)`, `cropModeSelected(int)`, `cropApplyRequested()`, `nameChanged(QString)`, `resetPositionRequested()`, `transformEdited(model, before, after)` (gizmo-style; not merged), `transformFieldEdited(model, before, after)` (from the fields; quick steps in a row merge into one undo step through `MoveModelCommand`'s mergeable flag), `trimApplyRequested(TrimData)`, `untrimRequested()`.

`enum CropMode { CropRemoveInside = 0, CropRemoveOutside = 1, CropMoveContents = 2 }`.
