@echo off
setlocal enabledelayedexpansion

:: ============================================================
::  Genesis Alpha Build - build a distributable desktop app
::
::  Builds the Release configuration and packages it so it runs on
::  machines without Visual Studio, Qt or this repo:
::    dist\                       ready-to-run folder (Codefine.exe)
::    build\Codefine-*-win64.zip  the same folder, zipped
::    build\Codefine-*-win64.exe  installer (only if NSIS is installed:
::                                https://nsis.sourceforge.io)
::
::  Run run.bat once first: it downloads Qt and configures build\.
:: ============================================================

set "DOUBLECLICK="
echo !cmdcmdline! | "%SystemRoot%\System32\find.exe" /i "%~nx0" >nul
if not errorlevel 1 set "DOUBLECLICK=1"

cd /d "%~dp0"

if not exist "build\Codefine.sln" (
    echo build\ is not configured yet. Run run.bat once first, then rerun this.
    goto :error
)

:: Resolve CMake (and CPack beside it) the same way run.bat does.
set "CMAKE=cmake"
set "CPACK=cpack"
where cmake >nul 2>&1
if not errorlevel 1 goto :cmake_ready

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VSDIR="
if exist "%VSWHERE%" for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSDIR=%%i"
set "VSCMAKEBIN=%VSDIR%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin"
if not exist "%VSCMAKEBIN%\cmake.exe" (
    echo CMake was not found on PATH or in Visual Studio.
    goto :error
)
set "CMAKE=%VSCMAKEBIN%\cmake.exe"
set "CPACK=%VSCMAKEBIN%\cpack.exe"

:cmake_ready

:: Reconfigure so the install/packaging rules are picked up.
"%CMAKE%" -S . -B build
if errorlevel 1 goto :error

echo Building Codefine (Release)...
"%CMAKE%" --build build --config Release --target Codefine
if errorlevel 1 goto :error

echo.
echo Installing into dist\ ...
if exist "dist" rmdir /s /q "dist"
:: Absolute prefix: Qt's deploy step rejects a relative one.
"%CMAKE%" --install build --config Release --component Codefine --prefix "%~dp0dist"
if errorlevel 1 goto :error

echo.
echo Creating package(s)...
pushd build
"%CPACK%" -C Release
set "CPACK_RESULT=%ERRORLEVEL%"
popd
if not "%CPACK_RESULT%"=="0" goto :error

echo.
echo ========================================
echo Done.
echo   Run it:   dist\Codefine.exe
echo   Share it: build\Codefine-*-win64.zip (or the .exe installer)
echo ========================================
if defined DOUBLECLICK pause
endlocal
exit /b 0

:error
echo.
echo ========================================
echo Packaging failed. See errors above.
echo ========================================
pause
exit /b 1
