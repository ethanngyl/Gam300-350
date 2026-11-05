@echo off
REM ============================================================
REM  Genesis backend - API smoke test (Windows launcher)
REM  Runs api-smoke.sh with Git Bash, which comes with Git (already
REM  a prerequisite, see README.txt). Settings: api-tests\.env or
REM  environment variables, see api-smoke.sh and .env.example.
REM ============================================================

setlocal
set "GITBASH="
for %%B in ("%ProgramFiles%\Git\bin\bash.exe" "%ProgramFiles(x86)%\Git\bin\bash.exe" "%LocalAppData%\Programs\Git\bin\bash.exe") do (
    if not defined GITBASH if exist %%B set "GITBASH=%%~B"
)
if not defined GITBASH (
    echo Git Bash was not found. Install Git for Windows: https://git-scm.com/download/win
    exit /b 2
)

"%GITBASH%" "%~dp0api-smoke.sh"
exit /b %errorlevel%
