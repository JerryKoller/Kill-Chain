@echo off
setlocal
title Audio Playground - Sync From Workspace

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Sync-From-Workspace.ps1" %*
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
  echo  Sync complete. You can close this window.
) else (
  echo  Sync failed with code %RC%. See output above.
)
pause
exit /b %RC%
