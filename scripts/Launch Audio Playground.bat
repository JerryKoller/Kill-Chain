@echo off
setlocal enabledelayedexpansion
title Audio Playground

rem -------------------------------------------------------------------
rem  Launcher invoked by the Desktop shortcut.
rem  - Detects existing Node.js installs even when not on PATH.
rem  - Offers to auto-install Node.js LTS via winget if it's missing.
rem  - First run: installs npm deps + builds the production bundle.
rem  - Subsequent runs: silently spawns Electron via the VBS helper.
rem -------------------------------------------------------------------

cd /d "%~dp0\.."

call :find_node
if errorlevel 1 (
  echo.
  echo  Node.js was not found on your system.
  echo.
  call :install_node
  if errorlevel 1 (
    echo.
    echo  Could not install Node.js automatically.
    echo  Please download the LTS build from https://nodejs.org/
    echo  and then double-click the Audio Playground icon again.
    echo.
    start "" "https://nodejs.org/"
    pause
    exit /b 1
  )
  call :find_node
  if errorlevel 1 (
    echo.
    echo  Node.js was installed but is not visible in this terminal session.
    echo  Close this window, then double-click the Audio Playground icon
    echo  on your Desktop again. It should work the second time.
    echo.
    pause
    exit /b 1
  )
  echo.
  echo  Node.js detected:
  node --version
  echo.
)

set "FIRST_RUN=0"
if not exist "node_modules\"            set "FIRST_RUN=1"
if not exist "dist\index.html"          set "FIRST_RUN=1"
if not exist "dist-electron\main.js"    set "FIRST_RUN=1"

rem Self-heal: an older build may have skipped the CommonJS marker
rem file. Without it, Node treats dist-electron/*.js (which tsc emits
rem as CommonJS) as ESM because the root package.json says
rem "type": "module" - Electron then crashes silently on launch.
if exist "dist-electron\main.js" if not exist "dist-electron\package.json" (
  node -e "require('fs').writeFileSync('dist-electron/package.json', JSON.stringify({type:'commonjs'}))" >nul 2>nul
)

rem Self-heal: detect a broken Electron install (postinstall did not
rem finish downloading the binary). The electron npm package writes
rem node_modules\electron\path.txt only after a successful binary
rem extraction, so its absence is a reliable signal. NB: just running
rem `npm install electron --force` does NOT redownload the binary -
rem npm sees the package as installed and skips the postinstall. The
rem only reliable repair is delete + reinstall, which is what the
rem dedicated Repair-Electron.ps1 does. Delegate to it here.
if exist "node_modules\electron\package.json" if not exist "node_modules\electron\path.txt" (
  echo.
  echo  Electron's binary install is incomplete ^(missing path.txt^).
  echo  Running clean delete + reinstall via scripts\Repair-Electron.ps1 ...
  echo.
  call powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Repair-Electron.ps1"
  if errorlevel 1 (
    echo.
    echo  Electron repair failed. Read the npm output above for the real
    echo  error. For a deeper run with cache clearing, try:
    echo      "%~dp0Repair Electron.bat" cache
    echo.
    pause
    exit /b 1
  )
)

if "%FIRST_RUN%"=="1" (
  echo.
  echo  First-time setup. This typically takes about a minute.
  echo  -----------------------------------------------------
  echo.

  if not exist "node_modules\" (
    echo  [1/2] Installing dependencies...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
      echo.
      echo  npm install failed.
      pause
      exit /b 1
    )
  )

  echo.
  echo  [2/2] Building the production desktop bundle...
  call npm run build
  if errorlevel 1 (
    echo.
    echo  Build failed.
    pause
    exit /b 1
  )

  echo.
  echo  Setup complete. Launching Audio Playground...
)

rem Hand off to a hidden wscript so the console closes if Electron
rem starts successfully. The VBS captures Electron's stdout/stderr
rem to electron-launch.log so we can diagnose a silent failure.
start "" wscript.exe "%~dp0_launch_electron.vbs"

rem Poll for up to ~10 seconds, waiting for electron.exe to appear.
rem As soon as it does, exit silently. If it never does, surface the
rem launch log in this console so the user can see what went wrong.
set "ELECTRON_UP=0"
for /l %%i in (1,1,10) do (
  if "!ELECTRON_UP!"=="0" (
    timeout /t 1 /nobreak >nul
    tasklist /fi "imagename eq electron.exe" /nh 2>nul | findstr /i "electron.exe" >nul && set "ELECTRON_UP=1"
  )
)

if "!ELECTRON_UP!"=="1" exit /b 0

echo.
echo  ============================================================
echo   Electron failed to start.
echo  ============================================================
echo.
if exist "electron-launch.log" (
  echo  Launch log ^(electron-launch.log^):
  echo  ------------------------------------------------------------
  type "electron-launch.log"
  echo.
  echo  ------------------------------------------------------------
) else (
  echo  No electron-launch.log was produced - the spawn itself failed.
  echo  Possible causes: npx not on PATH, electron not installed in
  echo  node_modules, or antivirus blocking cmd/wscript.
)
echo.
echo  For a more detailed run, double-click:
echo    scripts\Launch Audio Playground ^(Debug^).bat
echo.
pause
exit /b 1


rem -------------------------------------------------------------------
rem  :find_node
rem  Returns 0 if node.exe is reachable (and updates PATH if needed).
rem  Returns 1 otherwise.
rem -------------------------------------------------------------------
:find_node
where node >nul 2>nul
if not errorlevel 1 exit /b 0

rem Check common install locations and inject them into PATH for this session.
for %%P in (
  "%ProgramFiles%\nodejs"
  "%ProgramFiles(x86)%\nodejs"
  "%LOCALAPPDATA%\Programs\nodejs"
  "%LOCALAPPDATA%\Programs\Node.js"
  "%LOCALAPPDATA%\fnm_multishells"
  "%APPDATA%\nvm"
) do (
  if exist "%%~P\node.exe" (
    set "PATH=%%~P;!PATH!"
    exit /b 0
  )
)
exit /b 1


rem -------------------------------------------------------------------
rem  :install_node
rem  Attempts to install Node.js LTS using winget. Returns 0 on success.
rem -------------------------------------------------------------------
:install_node
where winget >nul 2>nul
if errorlevel 1 (
  echo  winget is not available on this machine, cannot auto-install.
  exit /b 1
)

echo  Installing Node.js LTS via winget. A Windows UAC prompt
echo  may appear - please click "Yes" so the installer can proceed.
echo.
winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
set "WG_RC=%ERRORLEVEL%"

rem winget returns 0 on success and a couple of other codes when
rem the package is already installed; treat any of those as success.
if "%WG_RC%"=="0" exit /b 0
if "%WG_RC%"=="-1978335212" exit /b 0
if "%WG_RC%"=="-1978335189" exit /b 0
echo  winget exited with code %WG_RC%
exit /b 1
