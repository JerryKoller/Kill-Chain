# Repair-Electron.ps1
# -----------------------------------------------------------------
#  Performs a CLEAN reinstall of the electron npm package so its
#  postinstall script (which downloads the Windows electron.exe
#  binary from GitHub releases) is forced to run again with output
#  visible. Use this when:
#     node_modules\electron\path.txt is missing
#  ...which produces the error:
#     "Electron failed to install correctly, please delete
#      node_modules/electron and try installing again"
#
#  Strategy:
#    1. Diagnose ELECTRON_* env vars (a set ELECTRON_SKIP_BINARY_DOWNLOAD
#       makes install.js exit silently with no files written).
#    2. Delete node_modules\electron.
#    3. Optionally clear the global download cache.
#    4. Re-run npm install electron with skip flags explicitly UNSET
#       in the child process environment.
#    5. If install.js still produces no path.txt, fall back to a
#       manual GitHub-releases download + extract. This bypasses
#       every layer of npm/postinstall logic.
# -----------------------------------------------------------------

[CmdletBinding()]
param(
  [switch] $ClearCache,
  [switch] $ManualOnly
)

$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

Write-Host ""
Write-Host " Audio Playground - Electron Repair" -ForegroundColor Cyan
Write-Host " -----------------------------------------------------------"
Write-Host "  Project root:    $ProjectRoot"
Write-Host "  Node version:    " -NoNewline; node --version
Write-Host "  npm version:     " -NoNewline; & npm --version
Write-Host ""

# -----------------------------------------------------------------
# Diagnostic: list all ELECTRON_* environment variables.
# A set ELECTRON_SKIP_BINARY_DOWNLOAD is the most common cause of the
# "postinstall ran in 1 second with no output and no files written"
# situation - install.js exits silently when this is truthy.
# -----------------------------------------------------------------
Write-Host "  Electron-related environment variables:"
$electronEnv = Get-ChildItem env: | Where-Object { $_.Name -like 'ELECTRON_*' -or $_.Name -like 'electron_*' }
if ($electronEnv.Count -eq 0) {
  Write-Host "    (none set)"
} else {
  foreach ($e in $electronEnv) {
    Write-Host ("    {0,-40} = {1}" -f $e.Name, $e.Value) -ForegroundColor Yellow
  }
  Write-Host ""
  Write-Host "  These will be EXPLICITLY UNSET in the npm child process." -ForegroundColor Yellow
}
Write-Host ""

$electronDir = Join-Path $ProjectRoot "node_modules\electron"
$pathTxt     = Join-Path $electronDir "path.txt"
$binaryExe   = Join-Path $electronDir "dist\electron.exe"
$cacheDir    = Join-Path $env:LOCALAPPDATA "electron\Cache"

# Pre-flight: report current state.
Write-Host "  Current state of node_modules\electron:"
if (Test-Path $electronDir) {
  $pkgJson   = Join-Path $electronDir "package.json"
  $hasPkg    = Test-Path $pkgJson
  $hasPath   = Test-Path $pathTxt
  $hasBinary = Test-Path $binaryExe
  Write-Host "    package.json     : " -NoNewline; if ($hasPkg)    { Write-Host "present" -ForegroundColor Green } else { Write-Host "MISSING" -ForegroundColor Red }
  Write-Host "    path.txt         : " -NoNewline; if ($hasPath)   { Write-Host "present" -ForegroundColor Green } else { Write-Host "MISSING" -ForegroundColor Red }
  Write-Host "    dist\electron.exe: " -NoNewline; if ($hasBinary) { Write-Host "present" -ForegroundColor Green } else { Write-Host "MISSING" -ForegroundColor Red }
} else {
  Write-Host "    [folder does not exist]"
}
Write-Host ""

# Read the expected electron version from package.json so the manual
# fallback grabs the right zip.
$rootPackageJsonPath = Join-Path $ProjectRoot "package.json"
$rootPkg = Get-Content -Raw $rootPackageJsonPath | ConvertFrom-Json
$electronSpec = $rootPkg.devDependencies.electron
if (-not $electronSpec) { $electronSpec = $rootPkg.dependencies.electron }
if (-not $electronSpec) { throw "Could not find 'electron' in package.json dependencies." }
# Strip the npm spec prefix (^, ~, >=, etc.) to leave a bare version.
$electronVersion = ($electronSpec -replace '^[^\d]*', '').Trim()
Write-Host "  Target electron version (from package.json): $electronVersion"
Write-Host ""

function Invoke-Step1-Clean {
  if (Test-Path $electronDir) {
    Write-Host "  [1/4] Removing node_modules\electron..."
    try {
      Remove-Item -Recurse -Force $electronDir -ErrorAction Stop
      Write-Host "        OK" -ForegroundColor Green
    } catch {
      Write-Host "        FAIL: $($_.Exception.Message)" -ForegroundColor Red
      Write-Host "        Close any running electron.exe / node.exe and re-run."
      throw
    }
  } else {
    Write-Host "  [1/4] node_modules\electron already gone - skipping delete."
  }
}

function Invoke-Step2-ClearCache {
  if ($ClearCache) {
    if (Test-Path $cacheDir) {
      Write-Host "  [2/4] Clearing electron download cache at $cacheDir ..."
      try {
        Remove-Item -Recurse -Force $cacheDir
        Write-Host "        OK" -ForegroundColor Green
      } catch {
        Write-Host "        Could not clear cache: $($_.Exception.Message)" -ForegroundColor Yellow
      }
    } else {
      Write-Host "  [2/4] No cache directory to clear."
    }
  } else {
    Write-Host "  [2/4] Skipping cache clear. Re-run with -ClearCache to force a fresh download."
  }
}

function Invoke-Step3-NpmInstall {
  Write-Host "  [3/4] Running 'npm install electron@$electronVersion --foreground-scripts'"
  Write-Host "        with ELECTRON_SKIP_BINARY_DOWNLOAD / electron_skip_binary_download"
  Write-Host "        explicitly UNSET so install.js cannot bail out silently..."
  Write-Host "        ============================================================"
  Write-Host ""

  # Build a clean environment for the child process. Start from a copy
  # of the current env, then strip anything that would tell install.js
  # to skip the download.
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName               = "cmd.exe"
  $psi.Arguments              = "/c npm install electron@$electronVersion --foreground-scripts --no-audit --no-fund"
  $psi.WorkingDirectory       = $ProjectRoot
  $psi.UseShellExecute        = $false
  $psi.RedirectStandardOutput = $false
  $psi.RedirectStandardError  = $false

  foreach ($e in (Get-ChildItem env:)) {
    $psi.EnvironmentVariables[$e.Name] = $e.Value
  }
  $killNames = @(
    "ELECTRON_SKIP_BINARY_DOWNLOAD",
    "electron_skip_binary_download",
    "ELECTRON_OVERRIDE_DIST_PATH",
    "electron_override_dist_path",
    "ELECTRON_CUSTOM_DIR",
    "electron_custom_dir",
    "ELECTRON_CUSTOM_FILENAME",
    "electron_custom_filename"
  )
  foreach ($name in $killNames) {
    if ($psi.EnvironmentVariables.ContainsKey($name)) {
      Write-Host "        Unsetting $name (was: $($psi.EnvironmentVariables[$name]))" -ForegroundColor Yellow
      [void]$psi.EnvironmentVariables.Remove($name)
    }
  }

  $p = [System.Diagnostics.Process]::Start($psi)
  $p.WaitForExit()

  Write-Host ""
  Write-Host "        ============================================================"
  return $p.ExitCode
}

function Invoke-Step4-ManualDownload {
  Write-Host "  [4/4] Falling back to manual download from GitHub releases..."
  Write-Host ""

  $url = "https://github.com/electron/electron/releases/download/v$electronVersion/electron-v$electronVersion-win32-x64.zip"
  $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "audio-playground-electron"
  if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir | Out-Null }
  $zipPath = Join-Path $tmpDir "electron-v$electronVersion-win32-x64.zip"
  $distDir = Join-Path $electronDir "dist"

  if (-not (Test-Path $electronDir)) {
    Write-Host "        node_modules\electron does not exist after npm install."
    Write-Host "        Re-creating the package skeleton..."
    New-Item -ItemType Directory -Path $electronDir | Out-Null
  }

  Write-Host "        Downloading: $url"
  Write-Host "        Destination:  $zipPath"
  try {
    # Use BITS if available (resumable, faster); fall back to Invoke-WebRequest.
    $ProgressPreference = 'Continue'
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
  } catch {
    Write-Host "        FAIL: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "        The download itself failed. Try the URL in a browser to confirm:"
    Write-Host "          $url"
    Write-Host "        If that fails too, you have a network/proxy/antivirus issue blocking"
    Write-Host "        outbound HTTPS to github.com or objects.githubusercontent.com."
    return $false
  }

  $zipSize = (Get-Item $zipPath).Length
  Write-Host ("        Downloaded {0:N0} bytes." -f $zipSize) -ForegroundColor Green

  if (Test-Path $distDir) {
    Write-Host "        Wiping existing dist\ directory..."
    Remove-Item -Recurse -Force $distDir
  }
  New-Item -ItemType Directory -Path $distDir | Out-Null

  Write-Host "        Extracting to $distDir ..."
  try {
    Expand-Archive -Path $zipPath -DestinationPath $distDir -Force
  } catch {
    Write-Host "        Extract FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "        This is almost certainly Windows Defender quarantining electron.exe."
    Write-Host "        Add this path as a Defender exclusion folder, then re-run:"
    Write-Host "          $electronDir"
    return $false
  }

  # Write the path.txt marker that electron/index.js looks for.
  $platformExe = "electron.exe"
  Write-Host "        Writing path.txt -> $platformExe"
  [System.IO.File]::WriteAllText($pathTxt, $platformExe)

  return $true
}

# -----------------------------------------------------------------
# Run the pipeline.
# -----------------------------------------------------------------
Invoke-Step1-Clean
Write-Host ""
Invoke-Step2-ClearCache
Write-Host ""

$npmRc = -1
if (-not $ManualOnly) {
  $npmRc = Invoke-Step3-NpmInstall
} else {
  Write-Host "  [3/4] Skipping npm install (-ManualOnly specified)."
}
Write-Host ""

# Verify after npm install.
$hasPath   = Test-Path $pathTxt
$hasBinary = Test-Path $binaryExe

Write-Host "  Post-npm-install state:"
Write-Host "    npm exit code    : $npmRc"
Write-Host "    path.txt         : " -NoNewline; if ($hasPath)   { Write-Host "present" -ForegroundColor Green } else { Write-Host "MISSING" -ForegroundColor Red }
Write-Host "    dist\electron.exe: " -NoNewline; if ($hasBinary) { Write-Host "present" -ForegroundColor Green } else { Write-Host "MISSING" -ForegroundColor Red }
Write-Host ""

if (-not ($hasPath -and $hasBinary)) {
  Write-Host "  npm install did not produce the binary. Falling back to manual download." -ForegroundColor Yellow
  Write-Host ""
  $manualOk = Invoke-Step4-ManualDownload
  Write-Host ""
  if ($manualOk) {
    $hasPath   = Test-Path $pathTxt
    $hasBinary = Test-Path $binaryExe
    Write-Host "  Post-manual-install state:"
    Write-Host "    path.txt         : " -NoNewline; if ($hasPath)   { Write-Host "present" -ForegroundColor Green } else { Write-Host "MISSING" -ForegroundColor Red }
    Write-Host "    dist\electron.exe: " -NoNewline; if ($hasBinary) { Write-Host "present" -ForegroundColor Green } else { Write-Host "MISSING" -ForegroundColor Red }
    Write-Host ""
  }
}

if ($hasPath -and $hasBinary) {
  Write-Host " ============================================================" -ForegroundColor Green
  Write-Host "  SUCCESS - Electron is fully installed. Launch the app." -ForegroundColor Green
  Write-Host " ============================================================" -ForegroundColor Green
  exit 0
}

Write-Host " ============================================================" -ForegroundColor Red
Write-Host "  REPAIR FAILED" -ForegroundColor Red
Write-Host " ============================================================" -ForegroundColor Red
Write-Host ""
Write-Host "  Manual recovery checklist:"
Write-Host "   1. Permanently unset any ELECTRON_SKIP_BINARY_DOWNLOAD env var:"
Write-Host "        setx ELECTRON_SKIP_BINARY_DOWNLOAD """""
Write-Host "      ...then open a new console and re-run this script."
Write-Host ""
Write-Host "   2. If the manual download itself failed, you have a network or"
Write-Host "      antivirus issue. Try the URL in a browser:"
Write-Host "        https://github.com/electron/electron/releases/download/v$electronVersion/electron-v$electronVersion-win32-x64.zip"
Write-Host ""
Write-Host "   3. If the download succeeded but the extract failed, add the"
Write-Host "      electron folder as a Windows Defender exclusion:"
Write-Host "        $electronDir"
Write-Host ""
exit 1
