@echo off
setlocal enabledelayedexpansion
title Audio Playground - Rebuild and Relaunch

rem -------------------------------------------------------------------
rem  Wipes the dist/ and dist-electron/ folders, re-runs `npm run build`,
rem  and then spawns Electron. Use this after pulling in code changes
rem  so the production bundle picks them up. The regular launcher only
rem  rebuilds on first run, so it won't notice a source-only update.
rem -------------------------------------------------------------------

cd /d "%~dp0\.."

where node >nul 2>nul
if errorlevel 1 (
  for %%P in (
    "%ProgramFiles%\nodejs"
    "%ProgramFiles(x86)%\nodejs"
    "%LOCALAPPDATA%\Programs\nodejs"
  ) do (
    if exist "%%~P\node.exe" set "PATH=%%~P;!PATH!"
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js not found on PATH. Run the regular launcher first to install it.
  pause
  exit /b 1
)

echo  Wiping previous build artifacts...
if exist "dist\"          rmdir /s /q "dist"
if exist "dist-electron\" rmdir /s /q "dist-electron"
echo  OK.
echo.

echo  Running npm run build ...
echo  -------------------------------------------------------------------
call npm run build
set "BUILD_RC=%ERRORLEVEL%"
echo  -------------------------------------------------------------------
echo.

if not "%BUILD_RC%"=="0" (
  echo  Build failed with code %BUILD_RC%. See output above.
  pause
  exit /b %BUILD_RC%
)

echo  Build OK. Launching Electron in foreground so any startup errors
echo  are visible. Close the Electron window to return to this console.
echo.
call npx --no-install electron .
set "RC=%ERRORLEVEL%"

echo.
echo  Electron exited with code %RC%.
pause
exit /b %RC%
