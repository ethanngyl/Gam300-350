# `Manager/AudioManager.h` / `AudioManager.cpp`

A thin wrapper over the **FMOD Core** API. It owns one `FMOD::System`, keeps loaded sounds cached by file path, and plays each sound on its own channel, so several sounds can overlap. The header forward-declares the FMOD types (`FMOD::System`, `Sound`, `Channel`), so files that include it do not pull in the FMOD headers.

Users: [ui/AudioPanel](../ui/AudioPanel.md) (the audio test panel) and [ui/ButtonSounds](../ui/ButtonSounds.md) (UI click sounds).

## State

| Member | Meaning |
|---|---|
| `m_system` | The FMOD system this class owns. It stays `nullptr` if initialisation failed. |
| `m_sounds` | Cache of `path -> FMOD::Sound*`. The class owns these and releases them in the destructor. |
| `m_channels` | Handles to voices that are playing. FMOD owns them, and `Update()` removes finished ones. |
| `m_lastError` | Readable text for the last failure, which the UI shows. |
| `kMaxChannels = 64` | Software channel limit passed to `init`. |

The class is **non-copyable** because it holds raw FMOD handles.

## Functions

### `AudioManager()`
Calls `FMOD::System_Create`, then `init(64, FMOD_INIT_NORMAL)`. If either call fails, it writes `FMOD_ErrorString(result)` into `m_lastError`, releases any half-made system and leaves `m_system == nullptr`. It never throws, so callers check `IsValid()` instead.

### `~AudioManager()`
Calls `StopAll()`, releases every cached `Sound`, then `close()`s and `release()`s the system.

### `bool IsValid() const`
Returns true when `m_system` is non-null, meaning FMOD initialised.

### `FMOD::Sound* GetOrLoad(const std::string& path)` *(private)*
Looks `path` up in `m_sounds`. If it is missing, calls `createSound(path, FMOD_DEFAULT)` and caches the result. If loading fails, it returns `nullptr` and sets `m_lastError` to `Could not load "<path>": <reason>`.

### `bool Play(const std::string& path)`
Starts the file on a **new** channel without stopping sounds that are already playing, so repeated calls layer on top of each other. It fails if the system is not initialised or the sound cannot be loaded or played. On success it saves the channel in `m_channels` and clears `m_lastError`.

### `void StopAll()`
Calls `stop()` on every saved channel and clears the list. Cached sounds stay loaded.

### `std::size_t PlayingCount() const`
Counts channels whose `isPlaying()` call succeeds **and** returns true. A finished or stolen channel returns an error and is not counted.

### `void Update()`
Pumps FMOD with `m_system->update()`, which FMOD needs for streaming, callbacks and freeing channels. It then compacts `m_channels` with swap-and-pop, dropping every voice that is null, finished or stolen, so the list cannot grow forever. Call it regularly, for example from a Qt timer.

### `const std::string& LastError() const`
Returns the last error message, or an empty string if there is none.
