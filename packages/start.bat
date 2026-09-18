@echo off
REM ============================================================
REM  CoDeFine - one-click launcher
REM  Builds the web app, then starts the backend + Cloudflare
REM  tunnel in their own windows so teammates can use the app.
REM
REM  Keep BOTH new windows open while teammates are using it.
REM  Close them (or press Ctrl+C in each) to stop.
REM ============================================================

setlocal
cd /d "%~dp0"

REM Make sure node / npm / cloudflared are found even if PATH is stale.
set "PATH=%PATH%;C:\Program Files\nodejs;C:\Program Files (x86)\cloudflared"

REM Install/refresh dependencies first. node_modules is not in git, and it goes
REM stale whenever someone pulls a commit that adds a package -- building
REM without this fails with "failed to resolve import". It's a fast no-op when
REM everything is already up to date.
echo [1/4] Installing dependencies (npm install)...
call npm install
if errorlevel 1 (
    echo.
    echo *** npm install failed - check your internet connection and Node.js install. ***
    pause
    exit /b 1
)

echo.
echo [2/4] Building the web app (npm run build)...
call npm run build
if errorlevel 1 (
    echo.
    echo *** Build failed - fix the errors above, then run this again. ***
    pause
    exit /b 1
)

echo.
echo [3/4] Starting backend on http://localhost:5005 ...
start "CoDeFine Backend" cmd /k "cd /d %~dp0src\backend && node server.js"

echo [4/4] Starting Cloudflare tunnel ...
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
