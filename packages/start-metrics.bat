@echo off
REM ============================================================
REM  Pipeline Metrics dashboard - builds and serves the
REM  standalone metrics app (src\metrics-dashboard) on
REM  http://localhost:5010. Separate from start.bat / the main app.
REM ============================================================

setlocal
cd /d "%~dp0"
set "PATH=%PATH%;C:\Program Files\nodejs"

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 ( pause & exit /b 1 )
)

echo Building the metrics dashboard...
call npm run metrics:build
if errorlevel 1 ( pause & exit /b 1 )

start "" http://localhost:5010
node src\metrics-dashboard\server.js
pause
endlocal
