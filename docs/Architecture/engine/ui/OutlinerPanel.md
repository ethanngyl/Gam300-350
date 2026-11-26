# `ui/OutlinerPanel.h` / `OutlinerPanel.cpp`

The contents of the editor's **Scene** dock: one row per model in the `SplatRenderer`, showing its name and splat count. It mirrors the renderer's selection, supports renaming in place, and asks MainWindow through signals to select, rename, hide, export or delete models. **The renderer stays the single source of truth**: call `rebuild()` whenever the model list changes.

## Layout
- A summary label: *"N / 32 models | M splats"*.
- A `QStackedWidget` that shows either an **empty-state hint** (how to import: Assets double-click, Ctrl+O, or drag-and-drop) or a two-column tree (**Name**, **Splats**) with single selection.

Data roles: `kIndexRole` (the renderer's model index) and `kHiddenRole`.

## Functions

### `OutlinerPanel(QWidget* parent)`
Builds the UI and connects:
- **`itemSelectionChanged`:** `selectionChanged(selectedIndex())`, unless a rebuild is running.
- **`itemChanged`** on the name column: `renameRequested(index, trimmed text)`. The rename is not applied here; MainWindow pushes a `RenameModelCommand`.
- **Double-click on the name:** opens the editor on the **next event-loop pass** (`QTimer::singleShot(0, …)`), using a `QPersistentModelIndex`. Opening it directly was buggy, because an already-selected row closed the editor again. The `DoubleClicked` edit trigger is not used, because it would also open an editor on the Splats column. **F2** and clicking an already-selected row also start editing.
- **Context menu:** *Rename (F2)*, *Hide* or *Show*, *Export…*, and *Delete*, which emit the matching signal.

### `void rebuild(SplatRenderer& renderer)`
With signals suppressed (`m_rebuilding`), it clears the tree and adds one editable row per model, with the splat count right-aligned. **Hidden models stay listed but greyed out and italic**, with a tooltip explaining how to show them (right-click → Show, or Ctrl+H). It selects the row of the renderer's selected model, switches between the empty state and the tree, and updates the summary.

### `void editSelectedName()`
Starts renaming the selected row in place. Edit → Rename uses it.

### `int selectedIndex() const` *(private)*
The selected row's model index, or −1.

## Signals
`selectionChanged(int)` (−1 means none), `renameRequested(int, QString)`, `deleteRequested(int)`, `toggleHiddenRequested(int)`, `exportRequested(int)`.
