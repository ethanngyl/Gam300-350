@echo off
setlocal enabledelayedexpansion

:: Builds the engine renderer for the browser (WebAssembly) and drops
:: codefine-engine.js / codefine-engine.wasm into
:: packages\src\web-app\public\engine, where the web app's viewer picks it up.
:: Re-run after changing anything in src\splat, src\gfx or web\.

:: Pause at the end when double-clicked so the output stays visible.
set "DOUBLECLICK="
echo !cmdcmdline! | "%SystemRoot%\System32\find.exe" /i "%~nx0" >nul
if not errorlevel 1 set "DOUBLECLICK=1"

echo ========================================
echo Codefine Engine - Web (WebAssembly) build
echo ========================================
echo.

cd /d "%~dp0"

:: Download the Emscripten SDK on first run into Library\emsdk (gitignored).
:: (Not named EMSDK_*: emsdk activate clears those.) Keep CF_EMSDK_VERSION in sync with the emscripten/emsdk image in docker/Dockerfile.
set "CF_EMSDK_VERSION=4.0.10"
set "CF_EMSDK_DIR=Library\emsdk"
if not exist "%CF_EMSDK_DIR%\emsdk.bat" (
    echo Emscripten SDK not found. Downloading it into %CF_EMSDK_DIR%...
    echo This is a one-time download of several hundred MB.
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git "%CF_EMSDK_DIR%"
    if errorlevel 1 goto :error
)
if not exist "%CF_EMSDK_DIR%\upstream\emscripten\emcc.bat" (
    call "%CF_EMSDK_DIR%\emsdk.bat" install %CF_EMSDK_VERSION%
    if errorlevel 1 goto :error
)
call "%CF_EMSDK_DIR%\emsdk.bat" activate %CF_EMSDK_VERSION% >nul 2>&1
if errorlevel 1 goto :error
set "EMSDK_QUIET=1"
call "%CF_EMSDK_DIR%\emsdk_env.bat" >nul 2>&1
if errorlevel 1 goto :error

:: CMake and Ninja: prefer PATH, else the copies bundled with Visual Studio.
set "CMAKE=cmake"
set "NINJA=ninja"
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VSDIR="
if exist "%VSWHERE%" for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -property installationPath`) do set "VSDIR=%%i"
where cmake >nul 2>&1
if errorlevel 1 if defined VSDIR set "CMAKE=%VSDIR%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
where ninja >nul 2>&1
if errorlevel 1 if defined VSDIR set "NINJA=%VSDIR%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"

if not exist "build-web\build.ninja" (
    echo Configuring web build...
    call emcmake "%CMAKE%" -S web -B build-web -G Ninja -DCMAKE_MAKE_PROGRAM="%NINJA%" -DCMAKE_BUILD_TYPE=Release
    if errorlevel 1 (
        if exist "build-web\CMakeCache.txt" del /q "build-web\CMakeCache.txt"
        goto :error
    )
)

echo Building codefine-engine.wasm...
"%CMAKE%" --build build-web
if errorlevel 1 goto :error

echo.
echo Done. Output: packages\src\web-app\public\engine\
if defined DOUBLECLICK pause
exit /b 0

:error
echo.
echo ========================================
echo Web build failed. See errors above.
echo ========================================
:: Only pause when double-clicked; packages\start.bat calls this and carries on.
if defined DOUBLECLICK pause
exit /b 1
