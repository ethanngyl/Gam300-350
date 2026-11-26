# `ui/AudioPanel.h` / `AudioPanel.cpp`

The contents of the editor's **Audio** dock. It lists the audio files in a chosen folder and plays them, several at once if wanted, through an [AudioManager](../Manager/AudioManager.md) it owns and pumps on a timer.

## Constants
- `kAudioUpdateMs = 50`: FMOD is pumped about 20 times a second.
- `kAudioNameFilters`: `*.wav *.ogg *.mp3 *.flac *.aiff *.aif *.wma *.m4a`.
- `DefaultAudioDir()`: `assets/audio`.
- `kPathRole`: the item data role that holds the absolute path.

## Functions

### `AudioPanel(QWidget* parent)`
Builds: *Choose Folder…* plus a folder label; a multi-select `QListWidget`; *Play Selected*, *Play File…* and *Stop All* plus a *"Playing: N"* label; and a status label.
- If FMOD failed to start, it shows *"Audio unavailable: <reason>"*, turns every control off, and returns.
- Otherwise it lists `DefaultAudioDir()` and connects:
  - *Choose Folder…*: a directory dialog, then `setFolder`.
  - *Play Selected*: `playSelected()`. Double-clicking a row calls `playPath` for that row only.
  - *Play File…*: a file dialog filtered to the audio types, then `playPath`.
  - *Stop All*: `stopAll()`.
  - A 50 ms timer that calls `m_audio->Update()` and refreshes the *Playing: N* count.

### `~AudioPanel()`
Defaulted, but defined in the `.cpp` for the `unique_ptr` of an incomplete type.

### `QString folder() const` / `void setFolder(const QString& dir)`
`setFolder` falls back to the default folder for an empty or missing `dir`. It clears the list and adds one item per matching file (name order), each with its path stored in `kPathRole`. The label shows `<path>  (N files)`. If no folder can be found (the build has no `ENGINE_ASSETS_DIR`), it says so.

### `void stopAll()`
`m_audio->StopAll()`, then shows *"Stopped all."*.

### `void playPath(const QString& path, const QString& displayName)` *(private)*
Plays one file. It shows *"Playing: <name>"*, or the error, which is also logged.

### `void playSelected()` *(private)*
Plays every selected file so they layer together. With no selection it asks the user to select files. It reports *"Started N files."* or *"Started X of N. Last error: …"*.
