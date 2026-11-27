# `ui/ConsolePanel.h` / `ConsolePanel.cpp`

The contents of the editor's **Console** dock. While it exists it captures **`std::cout`, `std::cerr` and Qt's `qDebug`/`qInfo`/`qWarning`/`qCritical`** output and shows each line timestamped and colour-coded by severity. The captured streams are still echoed to their original destinations, so the terminal that launched the engine sees everything too. Only one ConsolePanel should exist at a time.

## Types
- `enum class Level { Info, Warning, Error }`.
- `struct Entry { Level level; QString html; }`: every line posted, up to 5000, kept so a filter change can rebuild the view.

## Internals
- `kMaxLines = 5000`, applied to both the entry deque and `QPlainTextEdit::setMaximumBlockCount`.
- Filter indices: `kShowAll`, `kShowWarningsAndErrors`, `kShowErrors`.
- `g_console` (atomic pointer to the live panel) and `g_previousHandler` (the Qt message handler that was installed before).
- **`HandleQtMessage(type, context, msg)`**: maps `QtWarningMsg` to Warning and Critical/Fatal to Error (everything else is Info), posts the line to the live console, then **calls the previous handler** so Qt's default output (stderr or the debugger) still happens.
- **`LevelColour(level)`**: Warning `#e6b450`, Error `#f07178`, Info `#dcdcdc`.

### `class ConsolePanel::StreamRedirect : public std::streambuf`
Replaces a `std::ostream`'s buffer for its whole lifetime and restores the original in its destructor.
- **`overflow(ch)`**: under a mutex (because worker threads such as the loader write to cout and cerr), it forwards the character to the **original** buffer and adds it to the current line. On `\n` it posts the line; `\r` is dropped.
- **`sync()`**: forwards `pubsync()` to the original buffer.

## Functions

### `ConsolePanel(QWidget* parent)`
Builds a toolbar (*Clear*, a filter combo with *All messages / Warnings and errors / Errors only*, and counters) and a read-only, unwrapped Consolas `QPlainTextEdit`.
- **Clear** empties the entries, the view and the counters.
- **Changing the filter** rebuilds the view from `m_entries`.

It then installs `StreamRedirect`s on `std::cout` (Info) and `std::cerr` (Error), sets `g_console = this`, and installs `HandleQtMessage` with `qInstallMessageHandler`, saving the previous handler.

### `~ConsolePanel()`
Puts back the previous Qt handler, clears `g_console`, and destroys the redirects, which restores the original stream buffers.

### `void post(Level, const QString& text)`
**Thread safe.** It uses `QMetaObject::invokeMethod(this, …)` to run `append` on the GUI thread. The call is queued when it comes from another thread, and queued calls are dropped automatically if the panel is destroyed first.

### `void append(Level, const QString& text)` *(private)*
Builds HTML: a grey `HH:mm:ss` timestamp, then the HTML-escaped text in the level colour with `white-space:pre`. It stores the entry (dropping the oldest beyond 5000), updates the *"N warnings, M errors"* counter, and appends the line to the view if it passes the filter.

### `bool passesFilter(Level) const` *(private)*
"Warnings and errors" hides Info; "Errors only" shows only Error.
