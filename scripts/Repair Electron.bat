@echo off
rem -------------------------------------------------------------------
rem  Cleanly re-installs the electron npm package so its postinstall
rem  (which downloads the Windows electron.exe binary from GitHub
rem  releases) is forced to run again with output visible.
rem
rem  Use this if the app's debug launcher reports:
rem     "Electron failed to install correctly..."
rem
rem  Pass "cache" as the first argument to also clear the global
rem  electron download cache at %LOCALAPPDATA%\electron\Cache, which
rem  is useful when a corrupted cached download is causing the failure.
rem -------------------------------------------------------------------

setlocal
title Audio Playground - Repair Electron

set "SCRIPT_DIR=%~dp0"
set "EXTRA="

if /i "%~1"=="cache" set "EXTRA=-ClearCache"

rem Make sure node is reachable. Inherits PATH from the user's shell;
rem if winget installed Node into a non-PATH location, prepend it.
where node >nul 2>nul
if errorlevel 1 (
  for %%P in (
    "%ProgramFiles%\nodejs"
    "%ProgramFiles(x86)%\nodejs"
    "%LOCALAPPDATA%\Programs\nodejs"
  ) do (
    if exist "%%~P\node.exe" set "PATH=%%~P;%PATH%"
  )
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Repair-Electron.ps1" %EXTRA%
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo  Repair complete. You can close this window and double-click the
  echo  Audio Playground icon on your Desktop to launch the app.
) else (
  echo  Repair did not succeed. Scroll up to read the npm postinstall
  echo  output - the real error message is in there.
  echo.
  echo  If you don't see anything obvious, re-run this script with the
  echo  "cache" argument to also clear the global electron download
  echo  cache and force a fresh download:
  echo.
  echo      "Repair Electron.bat" cache
)
echo.
pause
exit /b %RC%
