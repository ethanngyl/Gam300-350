# `Manager/InputManager.h` / `InputManager.cpp`

Turns raw Qt mouse and keyboard events into **actions** and sends each action to registered callbacks. The viewport passes events in, and systems such as the camera subscribe with `AddCallBack`. It also tracks the active editor **tool mode** (Q/W/E/R).

## Enums

| Enum | Values | Purpose |
|---|---|---|
| `STATE` | `NONE`, `NORMAL`, `ALL_STATES` | Input context. Each state has its own set of callbacks. The current state is always `NORMAL`. |
| `KEY_ACTIONS` | `LEFT_CLICK`, `RIGHT_CLICK`, `SCROLL`, `FORWARD`, `BACKSWARD`, `LEFT`, `RIGHT`, `ALL_ACTIONS` | Logical actions. |
| `INPUT_TYPE` | `PRESS`, `HOLD`, `RELEASE`, `ALL_INPUTS` | Phase of the input. |
| `TOOL_MODE` | `PAN`, `TRANSLATE`, `ROTATE`, `SCALE` | Active gizmo tool. The default is `TRANSLATE`. |

Callbacks are stored as `std::vector<std::function<void(InputManager&, INPUT_TYPE)>> m_inputCallback[ALL_STATES][ALL_ACTIONS]`: one list for each state and action pair.

## Functions

### Getters
`GetState()`, `GetToolMode()`, `GetDx()`, `GetDy()` (mouse delta from the last click or drag event) and `GetScrollY()` (wheel delta from the last scroll).

### `void SetToolMode(TOOL_MODE mode)`
Does nothing if `mode` is already active. Otherwise it stores the mode and calls the `m_onToolModeChanged` callback, so the toolbar can update its highlighted button.

### `void SetOnToolModeChanged(std::function<void(TOOL_MODE)>)`
Registers the single listener for tool-mode changes.

### `void CallbackMouseClick(int button, INPUT_TYPE, double dx, double dy)`
Stores `dx`/`dy`, then fires `RIGHT_CLICK` for `Qt::RightButton` or `LEFT_CLICK` for `Qt::LeftButton`, with the given phase. The viewport calls it on every press, drag (`HOLD`) and release.

### `void CallbackMouseScroll(double yScroll)`
Stores the wheel delta and fires `SCROLL` with `HOLD`.

### `void CallbackKeyPress(int key, INPUT_TYPE)`
- On a real `PRESS` (not auto-repeat or release), **Q/W/E/R** switch to `PAN`/`TRANSLATE`/`ROTATE`/`SCALE`, and the function returns.
- The arrow keys fire `FORWARD`/`BACKSWARD`/`LEFT`/`RIGHT` with the given phase. WASD movement is commented out because W now selects the translate tool.

### `void AddCallBack(STATE, KEY_ACTIONS, callback)`
Adds `callback` to the list for that state and action. Passing `ALL_STATES` registers it in **every** state from `NONE` up to the last one.

### `void TriggerCallback(KEY_ACTIONS, INPUT_TYPE)` *(private)*
Calls every callback registered for `(m_inputState, action)`, in registration order, with `*this` and the phase.
