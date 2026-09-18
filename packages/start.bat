@echo off
REM ============================================================
REM  CoDeFine - one-click launcher
REM  Installs deps, fetches COLMAP / Brush / cloudflared on first
REM  run, builds the web app, then starts the backend + Cloudflare
REM  tunnel in their own windows so teammates can use the app.
REM
REM  Keep BOTH new windows open while teammates are using it.
REM  Close them (or press Ctrl+C in each) to stop.
REM ============================================================

setlocal
cd /d "%~dp0"

REM Make sure node / npm / cloudflared are found even if PATH is stale.
REM tools\ (repo root) goes first so a repo-local cloudflared.exe wins.
set "TOOLS=%~dp0..\tools"
set "PATH=%TOOLS%;%PATH%;C:\Program Files\nodejs;C:\Program Files (x86)\cloudflared"

REM Install/refresh dependencies first. node_modules is not in git, and it goes
REM stale whenever someone pulls a commit that adds a package -- building
REM without this fails with "failed to resolve import". It's a fast no-op when
REM everything is already up to date.
echo [1/5] Installing dependencies (npm install)...
call npm install
if errorlevel 1 (
    echo.
    echo *** npm install failed - check your internet connection and Node.js install. ***
    pause
    exit /b 1
)

echo.
echo [2/5] Building the web app (npm run build)...
call npm run build
if errorlevel 1 (
    echo.
    echo *** Build failed - fix the errors above, then run this again. ***
    pause
    exit /b 1
)

REM ---- External tools ------------------------------------------------------
REM COLMAP, Brush and cloudflared are standalone programs, not npm packages, so
REM npm install doesn't provide them. Each is fetched once into tools\ (all
REM gitignored) if the backend can't already find it.
echo.
echo [3/5] Checking for external tools...

REM COLMAP / Brush: ask the backend's own config.js where it resolves each
REM binary (repo tools\, sibling ..\gsplat-tools, or COLMAP_BIN / BRUSH_BIN),
REM and only run the tools\get-*.ps1 downloader when that file doesn't exist.
REM The node checks stay outside the if-blocks: their parentheses would
REM otherwise terminate the block early.
node -e "import('./src/backend/config.js').then(m=>import('node:fs').then(fs=>process.exit(fs.existsSync(m.config.colmapBin)?0:1)))"
if errorlevel 1 (
    echo     COLMAP not found - downloading into the tools folder - one-time, about 130 MB...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%TOOLS%\get-colmap.ps1"
    if errorlevel 1 (
        echo.
        echo *** Could not download COLMAP. Check your internet connection, then run
        echo *** tools\get-colmap.ps1 by hand to see the full error.
        pause
        exit /b 1
    )
) else (
    echo     COLMAP found.
)

node -e "import('./src/backend/config.js').then(m=>import('node:fs').then(fs=>process.exit(fs.existsSync(m.config.brushBin)?0:1)))"
if errorlevel 1 (
    echo     Brush not found - downloading into the tools folder - one-time, about 160 MB...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%TOOLS%\get-brush.ps1"
    if errorlevel 1 (
        echo.
        echo *** Could not download Brush. Check your internet connection, then run
        echo *** tools\get-brush.ps1 by hand to see the full error.
        pause
        exit /b 1
    )
) else (
    echo     Brush found.
)

REM cloudflared: single-file exe from GitHub, saved as tools\cloudflared.exe.
REM curl.exe ships with Windows 10+, so no installer or admin rights needed.
where cloudflared >nul 2>nul
if errorlevel 1 (
    echo     cloudflared not found - downloading into the tools folder - one-time, about 60 MB...
    curl -L --fail --progress-bar -o "%TOOLS%\cloudflared.exe" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    if errorlevel 1 (
        del "%TOOLS%\cloudflared.exe" >nul 2>nul
        echo.
        echo *** Could not download cloudflared. Check your internet connection, or
        echo *** install it manually:  winget install --id Cloudflare.cloudflared
        pause
        exit /b 1
    )
    echo     Saved to %TOOLS%\cloudflared.exe
) else (
    echo     cloudflared found.
)

echo.
echo [4/5] Starting backend on http://localhost:5005 ...
start "CoDeFine Backend" cmd /k "cd /d %~dp0src\backend && node server.js"

echo [5/5] Starting Cloudflare tunnel ...
start "CoDeFine Tunnel" cmd /k "cloudflared tunnel --protocol http2 --url http://localhost:5005"

echo.
echo ============================================================
echo  Two windows are opening:
echo    - "CoDeFine Backend" : job / training logs
echo    - "CoDeFine Tunnel"  : the public https://...trycloudflare.com URL
echo.
echo  Copy the trycloudflare.com URL from the Tunnel window and
echo  share it with your teammates. Keep BOTH windows open while
echo  they use the app; close them to stop.
echo ============================================================
echo.
pause
endlocal
