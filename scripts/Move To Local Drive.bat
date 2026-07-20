@echo off
rem -------------------------------------------------------------------
rem  Migrate the Audio Playground project off OneDrive to the local
rem  hard drive, then install a Desktop shortcut that points at the
rem  LOCAL copy. The OneDrive copy is left untouched unless you pass
rem  -RemoveSource to the PowerShell script.
rem -------------------------------------------------------------------

setlocal
title Audio Playground - Move to Local Drive

set "SCRIPT_DIR=%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Move-To-Local-Drive.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo  Migration complete. You can close this window.
) else (
  echo  Migration exited with code %RC%.
)
echo.
pause
exit /b %RC%
