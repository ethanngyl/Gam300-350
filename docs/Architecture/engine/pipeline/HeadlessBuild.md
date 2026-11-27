# `pipeline/HeadlessBuild.h` / `HeadlessBuild.cpp`

The engine's **command-line model build**. It runs [LocalReconstruction](LocalReconstruction.md) without opening the editor, which is useful for scripting and testing.

```
Codefine --build-model <photo folder | photos... | videos...>
         [--out <folder>] [--name <name>] [--iters <n>] [--fps <n>]
         [--remove-background] [--auto-crop]
```

Exit code: **0** when the `.ply` was saved, **1** when the build failed, **2** for bad arguments.

The engine is a Windows GUI app, so `cmd.exe` does not wait for it. Use `start /b /wait "" Codefine.exe --build-model ...` (as `run.bat` does), or in PowerShell `Start-Process -Wait -NoNewWindow -PassThru`.

## Public functions

### `bool IsHeadlessBuild(const QStringList& args)`
Returns true if `--build-model` is among the arguments. `main()` checks this before it creates any UI.

### `int RunHeadlessBuild(const QStringList& args)`
1. Calls `AttachParentConsole()` so output reaches the terminal.
2. **Parses the arguments.** `--out` and `--name` take a value. `--iters` must be a whole number from 1000 to 30000, and `--fps` must be greater than 0; either error returns 2. `--remove-background` and `--auto-crop` are flags. A folder argument adds `PhotosInFolder(folder)`. A file argument adds its absolute path. Anything else prints *"Unknown argument…"* and returns 2.
3. With no files, it prints usage and returns 2.
4. **Validates the inputs** with the same rules as the dialog. Every file must be a photo or a video, photos and videos cannot be mixed, and `FileCountProblem()` must return no message.
5. Creates a `LocalReconstruction` and a `QEventLoop`, and connects:
   - `statusChanged`: prints `"[ 42%] phase  detail"` once per phase change, and again whenever the detail is a training *"Iteration…"* counter;
   - `finished`: prints *Saved <path>* (exit code 0) or *Failed: <error>*, prints the log path, then quits the loop.
6. On Windows, installs a console control handler, then calls `build.start(request, outFolder)` and runs the loop until the build finishes. Afterwards it removes the handler and signals `g_buildDone`.

## Internal helpers

- **`Print(text)`**: writes the text in the local 8-bit encoding plus a newline to stdout, and flushes.
- **`IsRedirected(which)`** *(Windows)*: returns true if a standard handle already points at a file or pipe.
- **`AttachParentConsole()`** *(Windows)*: the exe is linked as `WIN32_EXECUTABLE` and starts without a console. This calls `AttachConsole(ATTACH_PARENT_PROCESS)` and reopens stdout and stderr on `CONOUT$`, **unless the caller redirected them** (for example `> build.log`). It also prints a newline because cmd has usually printed its prompt already.
- **`OnConsoleControl(DWORD type)`** *(Windows)*: COLMAP and Brush run with `CREATE_NO_WINDOW`, so they never receive Ctrl+C. Without this handler they would keep running hidden on the GPU.
  - With no build running, it returns `FALSE`, which gives the default behaviour (exit).
  - On the first Ctrl+C or Break, it queues `build->cancel()` onto the main thread with `QMetaObject::invokeMethod(..., QueuedConnection)` and returns `TRUE`.
  - On a second Ctrl+C, it returns `FALSE`, so the process exits without a clean cancel.
  - On window close, logoff or shutdown, Windows ends the process as soon as the handler returns and allows about 5 s. The handler therefore waits up to 4.5 s on `g_buildDone`, giving the cancel time to stop the tools and delete the work folders.
- The globals `g_build` (atomic pointer), `g_cancelRequested` and `g_buildDone` (a manual-reset event) are shared between the handler thread and the main thread.
