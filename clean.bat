@echo off
echo ========================================
echo Deep Clean - Removing All Build Artifacts
echo ========================================
echo.

:: Remove build directories
if exist "build" rmdir /s /q "build"
if exist "out" rmdir /s /q "out"
if exist "bin" rmdir /s /q "bin"

:: Remove Visual Studio files
if exist ".vs" rmdir /s /q ".vs"
del /q *.sln 2>nul
del /q *.vcxproj 2>nul
del /q *.vcxproj.filters 2>nul
del /q *.vcxproj.user 2>nul

:: Remove CMake cache
del /q CMakeCache.txt 2>nul
if exist "CMakeFiles" rmdir /s /q "CMakeFiles"

echo All build artifacts removed.
echo.
echo ========================================
pause