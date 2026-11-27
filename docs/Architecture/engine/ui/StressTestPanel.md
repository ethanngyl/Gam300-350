# `ui/StressTestPanel.h` / `StressTestPanel.cpp`

The **Stress Test** dock. Its buttons start the tests in [Manager/StressTestRunner](../Manager/StressTestRunner.md) (MainWindow does the actual running), and it shows the timed results in a colour-coded table that can be collapsed per test. It has no test logic of its own.

## Layout
- **Row 1:** *Test All* (loads a new test sphere first), *Test All (Current)* (uses the selected model; the Splats box is ignored), *Stop*, a *Splats* spin box (1,000 – 10,000,000, step 100k, default 1,000,000, with group separators), *Collapse All*, *Expand All*, *Clear Results*.
- **Row 2:** *Load / Select / Move / Trim / Delete / Undo-Redo / Export Test*, each run on the selected model.
- A red **failure banner**, visible until the results are cleared.
- A table with columns **Test / Splats / Time (ms)**: read-only, whole-row selection.
- A description label showing the selected row's explanation. It always matches that row's tooltip.

Every run button's tooltip includes `kBusyNote`: tests run on the GUI thread, so Windows may show *Not Responding* at several million splats.

## Constants
- `kTestColors[8]`: dark, muted colours (blue, green, amber, purple, teal, red, olive, magenta). Each test name keeps its colour for the panel's lifetime, even after *Clear*.
- `kFailColor #b41e1e`: a stronger red than any test colour.
- Data roles on a row's first cell: `Qt::UserRole` (failed flag), `kGroupRole`, `kTotalRole`, `kBaseNameRole`.
- `kCollapseByDefault = true`: new results start collapsed, showing only their total.
- **`TotalLabel(name, collapsed)`**: puts ▸ (collapsed) or ▾ (expanded) in front of the name.

## Functions

### `StressTestPanel(QWidget* parent)`
Builds the UI. Each test button emits its `…Requested` signal. *Collapse All* and *Expand All* call `SetAllGroupsCollapsed`. **Double-clicking a total row** toggles its group. *Clear Results* empties the table and resets the groups, failure count and banner. *Clear* is a run button and is turned off during a test; *Collapse All*, *Expand All* and *Stop* are not run buttons and stay usable.

### `double AddResults(const std::vector<StressResult>&, const QString& testName)`
1. Picks the colour by the position of `testName` in `m_testNames`, adding the name if it is new.
2. Gives the batch a new **group id**, so each run can be collapsed on its own.
3. Adds one row per result. A **failed** result becomes `"<name> (FAILED)"`, with *FAILED* in the time column, a red bold white-text row, a tooltip that starts with the reason, and is **not counted in the total**.
4. Adds a bold **total** row, `"<test>: Total"` (plus `"(N failed)"`). Its tooltip explains that setup and clean-up are not timed and that a total with failures is incomplete. It is red if anything in the batch failed. The splat column is blank because the steps work on different splat counts.
5. If anything failed, updates and shows the banner.
6. Collapses the group if `kCollapseByDefault` is set (failed rows stay visible), scrolls to the bottom, and returns the total in ms.

### `int FailedCount() const`
Failed rows added since the last *Clear*.

### `void AddTotal(const QString& label, double ms, const QString& tooltip)`
Adds a bold grey total row that belongs to no group, for example the grand total of a *Test All* run.

### `size_t SplatCount() const`
The value of the Splats spin box.

### `void SetRunning(bool running, bool stoppable)`
Turns off every run button and the spin box while a test runs. *Stop* is enabled only when `running && stoppable`, which is the case for *Test All* between tests.

### `void ShowSelectedDescription()` *(private)*
Shows the current row's tooltip, or a hint when nothing is selected. A failed row's reason is shown in bold red.

### `void AppendRow(name, splats, time, tooltip, color, bold, failed, group, isTotal)` *(private)*
Adds a row and stores the group and total flags. **Every cell** gets the tooltip and background, so the tooltip shows wherever the mouse is. Bold applies to totals and failures. A failed row gets white text and the failed flag.

### `void SetGroupCollapsed(int group, bool collapsed)` / `void SetAllGroupsCollapsed(bool)` *(private)*
`SetGroupCollapsed` updates the collapsed set, swaps the total row's arrow, and hides or shows the group's rows. **Failed rows are never hidden**, so a failure cannot hide behind a total. If the selected row becomes hidden, the selection is cleared, so the description never explains a row that is not on screen. `SetAllGroupsCollapsed` applies this to every group that has a total row.

## Signals
`loadTestRequested`, `selectTestRequested`, `moveTestRequested`, `trimTestRequested`, `exportTestRequested`, `deleteTestRequested`, `undoRedoTestRequested`, `testAllRequested`, `testAllCurrentRequested`, `stopRequested`.
