/*!************************************************************************
\file HeadlessBuild.h
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
Declares the engine's command-line model build, which runs
LocalReconstruction without opening the editor (for scripting and testing):
  Codefine --build-model <photo folder | photos... | videos...>
           [--out <folder>] [--name <name>] [--iters <n>] [--fps <n>]
           [--remove-background]
Progress goes to the terminal that started it (the engine attaches to its
console); the exit code is 0 when the .ply was saved, 2 for bad arguments.
The engine is a Windows GUI app, so cmd.exe doesn't wait for it: run it as
  start /b /wait "" Codefine.exe --build-model ...
to wait for the build and get the exit code in %ERRORLEVEL% (run.bat does
the same). In PowerShell: Start-Process -Wait -NoNewWindow -PassThru.
**************************************************************************/
#pragma once

#include <QStringList>

// True if the arguments ask for a command-line build.
bool IsHeadlessBuild(const QStringList& args);
// Runs the build to completion (needs a QCoreApplication). Returns the process exit code.
int RunHeadlessBuild(const QStringList& args);
