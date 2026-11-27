# `ui/RemoteModelsPanel.h` / `RemoteModelsPanel.cpp`

The contents of the editor's **My Models** dock: the models the signed-in account reconstructed through the web app (every user's models, for an admin). It lists them with status and date, filters by name, downloads a finished one into the account's cache (reusing an up-to-date copy) and asks for it to be imported. **The backend decides which jobs appear**, never this panel. It uses [net/BackendClient](../net/BackendClient.md).

## Layout
- Top row: Refresh, an account label (*"Name (email) | admin: every user's models"*), a name filter, a Sign In / Sign Out button, and **Import**.
- A message label (loading, errors, empty state).
- A tree with **Name / Status / Created**, sorted by Created, newest first.
- A download progress bar with Cancel, hidden when idle.

## Helpers
- **`JobItem`**: sorts the Created column by the stored epoch milliseconds (`kTimeRole`) instead of the displayed text.
- **`StatusText(job)`**: `done` becomes *Ready* (or *No model*), `running` becomes *Processing N%*, `queued` *Queued*, `error` *Failed*, `cancelled` *Cancelled*.
- **`SafeFileName(name)`**: replaces characters that are illegal in file names, trims, removes trailing dots, and cuts to 80 characters.

## Functions

### `RemoteModelsPanel(BackendClient* client, QWidget* parent)`
Builds the UI and connects:
- **Refresh:** `refresh()`. **Filter:** `applyFilter()`. **Import or double-click:** `openCurrent()`. **Current row changed:** `updateButtons()`.
- **Cancel:** `client->cancelDownload()`.
- **Account button:** `signOut()` when signed in, otherwise emits `signInRequested()`.
- **Context menu:** *Import into Scene* (enabled to match the Import button) and *Refresh*.
- **Client signals:**
  - `sessionChanged` → `onSessionChanged`;
  - `jobsReceived` → `showJobs`;
  - `requestFailed` → show the error;
  - `downloadProgress` → a 0–1000 bar showing *"X of Y"*, or an indeterminate bar if the size is unknown;
  - `downloadFinished` → hide the progress row, then show the error or emit `importRequested(path)`.

It finishes with `onSessionChanged()`.

### `void refresh()`
When signed in, calls `fetchJobs()`. Otherwise, if a session is saved, calls `restoreSession()`, for example when the server was down at startup.

### `void onSessionChanged()` *(private)*
Clears the list and progress row. **Signed in:** fills in the account label, sets the button to *Sign Out* (its tooltip warns that this deletes downloaded models), shows *Loading…* and fetches the jobs. **Signed out:** shows *"Not signed in"*, a *Sign In…* button and a hint.

### `void showJobs(const QList<RemoteJob>&)` *(private)*
Remembers the current job id and rebuilds the rows: display name with icon, status text, local short date, and a tooltip with the photo count and any error. **Jobs without a result are dimmed.** It restores the previous current row, shows *"No models yet…"* when the list is empty, sets the header to *"Name (N ready)"*, then calls `applyFilter()` and `updateButtons()`.

### `void applyFilter()` *(private)*
Hides rows whose name does not contain the filter text, ignoring case.

### `void updateButtons()` *(private)*
Refresh is enabled when signed in or a session is saved. Search is enabled when signed in. **Import** is enabled only when signed in, the current job has a result, and no download is running.

### `void openCurrent()` / `void open(const RemoteJob&)` *(private)*
`openCurrent` finds the job for the current row and calls `open`. `open`:
- returns if the job has no result or a download is already running;
- **reuses the cached file** if it exists, is not empty, and is at least as new as `job.updatedAt`, emitting `importRequested(path)` straight away;
- otherwise deletes the job's cache folder (a stale copy, perhaps under an old name), shows *"Downloading…"* and an indeterminate bar, and calls `downloadResult(job, path)`.

### `QString cachePath(const RemoteJob&) const` *(private)*
Returns `<cacheDir>/<safe job id>/<safe display name>.ply`, falling back to the first 8 characters of the id. **The file name becomes the model's name in the scene.**

## Signals
`importRequested(path)` and `signInRequested()`.
