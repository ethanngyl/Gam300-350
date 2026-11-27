# `ui/AssetBrowserPanel.h` / `AssetBrowserPanel.cpp`

The contents of the editor's **Assets** dock. It lists the Gaussian-splat `.ply` files in a folder (name, size, date), filters them by name, refreshes itself when the folder changes on disk, and asks for a file to be imported on double-click, the Import button, or the context menu.

## Layout
- Top row: Browse (folder icon), Refresh, a folder label (`#PanelHint`, selectable), a name filter with a clear button, and **Import**.
- A `QTreeWidget` with columns **Name** (stretches), **Size** and **Modified**. It is sortable and uses alternating row colours.

## Internal helpers
- **`DefaultSplatDir()`**: `AssetPaths::AssetsSubdir("samples")`, the bundled sample splats.
- Column constants `kNameColumn`, `kSizeColumn`, `kModifiedColumn`. Data roles: `kPathRole` (absolute path) and `kBytesRole` (raw size).
- **`FileItem`**: a `QTreeWidgetItem` whose `operator<` compares the **byte count** when sorting by the Size column. The displayed text ("1.2 MB") would otherwise sort as a string.

## Functions

### `AssetBrowserPanel(QWidget* parent)`
Builds the UI and connects:
- **Browse:** `QFileDialog::getExistingDirectory`, then `setFolder`.
- **Refresh:** `refresh()`. **Filter text changed:** `applyFilter()`.
- **Import button or double-click:** `requestImportOfCurrent()`. Import is enabled only while a row is current.
- **Context menu:** *Import into Scene* (only on a row), *Show in Explorer* and *Refresh*. The path is **copied before the menu opens**, because the watcher may rebuild the list, deleting the item, while the menu's event loop runs.
- **`QFileSystemWatcher::directoryChanged`:** `refresh()`, so a fresh export from the pipeline shows up on its own.

It then calls `setFolder(DefaultSplatDir())`.

### `QString folder() const`
The folder currently listed. MainWindow saves it between runs.

### `void setFolder(const QString& dir)`
An empty or missing `dir` falls back to the samples folder. It moves the watcher to the new absolute path and calls `refresh()`.

### `void refresh()` *(private)*
Remembers the path of the current row, turns sorting off, clears the list, and adds one `FileItem` for each readable `*.ply` (case-insensitive name order), with an icon, tooltip, formatted size and short-format date. It restores the previous current row if it still exists, turns sorting back on, updates the folder label (`<path>  (N .ply files)`), and calls `applyFilter()`.

### `void applyFilter()` *(private)*
Hides rows whose name does not contain the filter text, ignoring case.

### `void requestImportOfCurrent()` *(private)*
Emits `importRequested(path)` for the current row.

## Signals
`importRequested(const QString& path)`. MainWindow connects it to its import.
