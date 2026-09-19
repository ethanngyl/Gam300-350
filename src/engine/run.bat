@echo off
setlocal enabledelayedexpansion

:: Was this launched by double-clicking in Explorer (rather than from an
:: already-open terminal)? If so, pause before exiting so the window does
:: not vanish with the output still in it.
set "DOUBLECLICK="
:: Use the absolute path to find.exe: a Git Bash / MSYS "find" earlier on
:: PATH is the Unix one and rejects these arguments.
echo !cmdcmdline! | "%SystemRoot%\System32\find.exe" /i "%~nx0" >nul
if not errorlevel 1 set "DOUBLECLICK=1"

echo ========================================
echo Codefine Engine - Build ^& Run (Debug)
echo ========================================
echo.

:: Anchor to this script's directory (src/engine) so paths work
:: regardless of where the .bat is launched from.
cd /d "%~dp0"

:: Configure the CMake project on first run (or after a clean).
:: Test for the generated solution, NOT CMakeCache.txt: CMake writes the
:: cache early, so an interrupted first configure (the dependency fetch takes
:: ~90s) leaves a cache behind with no project files. Keying off the cache
:: would then skip configure forever and fail in the build step instead.
if not exist "build\Codefine.sln" (
    echo Configuring CMake project...
    echo This fetches dependencies from GitHub and can take a few minutes.
    cmake -S . -B build
    if errorlevel 1 (
        :: Drop the partial cache so the next run reconfigures from scratch.
        :: _deps is left alone, so already-fetched dependencies are reused.
        if exist "build\CMakeCache.txt" del /q "build\CMakeCache.txt"
        goto :error
    )
    echo.
)

:: Build the Debug configuration.
echo Building Codefine (Debug)...
cmake --build build --config Debug --target Codefine
if errorlevel 1 goto :error
echo.

if not exist "build\Debug\Codefine.exe" (
    echo Build reported success but build\Debug\Codefine.exe is missing.
    goto :error
)

:: Launch the engine.
echo Launching Codefine...
echo.

:: Codefine is linked as a Windows GUI app (WIN32_EXECUTABLE), and cmd.exe
:: does not wait for GUI-subsystem processes. Invoking the .exe directly would
:: return immediately, close this console, and discard the engine's stdout and
:: stderr. "start /b /wait" shares this console and waits for exit.
start /b /wait "" "build\Debug\Codefine.exe"
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
    echo ========================================
    echo Codefine exited with code %EXITCODE%.
    echo ========================================
    pause
    exit /b %EXITCODE%
)
echo Codefine exited normally.
if defined DOUBLECLICK pause
goto :end

:error
echo.
echo ========================================
echo Build failed. See errors above.
echo ========================================
pause
exit /b 1

:end
endlocal
exit /b 0
