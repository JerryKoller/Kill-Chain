@echo off
setlocal enabledelayedexpansion
title Audio Playground - DEBUG launcher

rem -------------------------------------------------------------------
rem  Diagnostic launcher. Runs Electron in the foreground with stderr
rem  visible. The window is GUARANTEED to stay open at the end so you
rem  can read any error - even if an early step bailed out.
rem -------------------------------------------------------------------

cd /d "%~dp0\.."

call :run
set "FINAL_RC=%ERRORLEVEL%"

echo.
echo  ===========================================================================
echo   Debug launcher finished. Exit code: %FINAL_RC%
echo   This window will stay open. Press any key to close it.
echo  ===========================================================================
pause >nul
exit /b %FINAL_RC%


rem -------------------------------------------------------------------
rem  :run  - all the real logic lives here. exit /b returns to the
rem  caller above which will still print the footer and pause.
rem -------------------------------------------------------------------
:run

echo  ===========================================================================
echo   Audio Playground - Debug Launcher
echo  ===========================================================================
echo   Project root: %CD%
echo.

rem ---- Locate Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  for %%P in (
    "%ProgramFiles%\nodejs"
    "%ProgramFiles(x86)%\nodejs"
    "%LOCALAPPDATA%\Programs\nodejs"
    "%LOCALAPPDATA%\Programs\Node.js"
  ) do (
    if exist "%%~P\node.exe" set "PATH=%%~P;!PATH!"
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] Node.js was not found on PATH.
  echo   Run the normal launcher first to auto-install Node, then re-run this.
  exit /b 1
)

rem ---- Diagnostics ----
echo   Diagnostics:
echo   ---------------------------------------------------------------------------
for /f "delims=" %%V in ('node --version 2^>^&1') do echo     node:        %%V
for /f "delims=" %%V in ('call npm --version 2^>^&1')  do echo     npm:         %%V

if exist "node_modules\electron\package.json" (
  for /f "tokens=2 delims=:," %%V in ('findstr /i "\"version\"" "node_modules\electron\package.json"') do (
    set "EVER=%%~V"
    set "EVER=!EVER:"=!"
    set "EVER=!EVER: =!"
    echo     electron:    !EVER!
  )
) else (
  echo     electron:    [NOT INSTALLED in node_modules]
)

echo.
echo   Build artifacts:
if exist "dist\index.html"          (echo     [OK]      dist\index.html)          else (echo     [MISSING] dist\index.html)
if exist "dist-electron\main.js"    (echo     [OK]      dist-electron\main.js)    else (echo     [MISSING] dist-electron\main.js)
if exist "dist-electron\preload.js" (echo     [OK]      dist-electron\preload.js) else (echo     [MISSING] dist-electron\preload.js)
if exist "dist-electron\package.json" (
  echo     [OK]      dist-electron\package.json
) else (
  echo     [MISSING] dist-electron\package.json  ^<-- this is the CommonJS marker
)
echo   ---------------------------------------------------------------------------
echo.

rem ---- Repair missing pieces ----
if not exist "node_modules\" (
  echo   node_modules missing - running npm install...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo   [ERROR] npm install failed.
    exit /b 1
  )
)

if not exist "dist\index.html"       set "NEED_BUILD=1"
if not exist "dist-electron\main.js" set "NEED_BUILD=1"

if defined NEED_BUILD (
  echo   Build artifacts missing - running npm run build...
  call npm run build
  if errorlevel 1 (
    echo   [ERROR] Build failed.
    exit /b 1
  )
)

if not exist "dist-electron\package.json" (
  echo   Writing dist-electron\package.json CommonJS marker...
  node -e "require('fs').writeFileSync('dist-electron/package.json', JSON.stringify({type:'commonjs'}))"
)

rem ---- Self-heal a broken Electron binary install ----
rem NB: `npm install electron --force` does NOT redownload the binary -
rem npm sees the package as installed and skips the postinstall. The
rem only reliable repair is delete + reinstall, which is what the
rem dedicated Repair-Electron.ps1 does. Delegate to it here.
if exist "node_modules\electron\package.json" if not exist "node_modules\electron\path.txt" (
  echo.
  echo   Electron binary install is incomplete - node_modules\electron\path.txt
  echo   is missing, so the postinstall download never finished.
  echo   Running clean delete + reinstall via scripts\Repair-Electron.ps1 ...
  echo.
  call powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Repair-Electron.ps1"
  if errorlevel 1 (
    echo.
    echo   [ERROR] Electron repair failed. Read the npm output above for the
    echo           real error. For a deeper run that also clears the global
    echo           electron download cache, run:
    echo               "%~dp0Repair Electron.bat" cache
    exit /b 1
  )
)

rem ---- Quick sanity test that Electron itself can launch ----
echo.
echo   Probing Electron binary...
call npx --no-install electron --version
if errorlevel 1 (
  echo   [ERROR] 'npx electron --version' failed - Electron is broken or missing.
  echo.
  echo   Try the deeper repair that also clears the global download cache:
  echo       "%~dp0Repair Electron.bat" cache
  exit /b 1
)

echo.
echo   ---------------------------------------------------------------------------
echo   Launching Electron in the foreground. Any output below this line is
echo   from Electron itself. The app window should appear within a few seconds.
echo   When you close the Electron window, control returns here.
echo   ---------------------------------------------------------------------------
echo.

call npx --no-install electron .
set "EC=%ERRORLEVEL%"

echo.
echo   ---------------------------------------------------------------------------
echo   Electron exited with code %EC%.
echo   ---------------------------------------------------------------------------
exit /b %EC%
