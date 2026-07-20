@echo off
rem -------------------------------------------------------------------
rem  Double-click this file to install the Audio Playground desktop
rem  shortcut. It just hands off to the PowerShell installer with the
rem  execution policy bypassed for this single invocation.
rem -------------------------------------------------------------------

setlocal
title Audio Playground - install shortcut

set "SCRIPT_DIR=%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Install-Desktop-Shortcut.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo  Shortcut installed. You can close this window.
) else (
  echo  Installer exited with code %RC%.
)
echo.
pause
exit /b %RC%
