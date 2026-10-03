@echo off
REM ============================================================
REM  CoDeFine - run web app + engine together
REM
REM  Thin launcher: it just starts the two existing scripts, each
REM  in its own window so they run side by side --
REM    - packages\start.bat : installs deps, builds, starts the
REM                           backend (http://localhost:5005) and
REM                           the Cloudflare tunnel
REM    - engine\run.bat     : builds the Debug config and launches
REM                           the engine (Codefine.exe)
REM
REM  First runs are slow: each script downloads its own tools
REM  (COLMAP / Brush / cloudflared, and Qt for the engine).
REM  Close a window (or press Ctrl+C in it) to stop that part.
REM ============================================================

setlocal
REM Anchor to this script's folder (repo root). The child windows
REM inherit this working directory, so the relative paths below work
REM even if the repo lives under a path that contains spaces.
cd /d "%~dp0"

echo Launching the CoDeFine web app and engine in separate windows...
echo.

REM Web app. start.bat opens its own extra windows (backend + tunnel).
start "CoDeFine Web App" cmd /k "cd /d packages && call start.bat"

REM Engine. run.bat builds then launches the engine GUI in this window.
start "CoDeFine Engine" cmd /k "cd /d engine && call run.bat"

echo Two windows are opening:
echo    - "CoDeFine Web App" : dependency setup, build, backend + tunnel
echo    - "CoDeFine Engine"  : CMake build, then the engine window
echo.
echo Close each window to stop that part.
endlocal
