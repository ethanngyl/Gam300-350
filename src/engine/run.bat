@echo off
setlocal
echo ========================================
echo Codefine Engine - Build ^& Run (Debug)
echo ========================================
echo.

:: Anchor to this script's directory (src/engine) so paths work
:: regardless of where the .bat is launched from.
cd /d "%~dp0"

:: Configure the CMake project on first run (or after a clean).
if not exist "build\CMakeCache.txt" (
    echo Configuring CMake project...
    cmake -S . -B build
    if errorlevel 1 goto :error
    echo.
)

:: Build the Debug configuration.
echo Building Codefine (Debug)...
cmake --build build --config Debug --target Codefine
if errorlevel 1 goto :error
echo.

:: Launch the engine.
echo Launching Codefine...
echo.
"build\Debug\Codefine.exe"
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
