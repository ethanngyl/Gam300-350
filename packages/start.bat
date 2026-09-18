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

echo [1/3] Building the web app (npm run build)...
call npm run build
if errorlevel 1 (
    echo.
    echo *** Build failed - fix the errors above, then run this again. ***
    pause
    exit /b 1
)

echo.
echo [2/3] Starting backend on http://localhost:5005 ...
start "CoDeFine Backend" cmd /k "cd /d %~dp0src\backend && node server.js"

echo [3/3] Starting Cloudflare tunnel ...
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
