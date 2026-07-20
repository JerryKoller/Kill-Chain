# Move-To-Local-Drive.ps1
# -----------------------------------------------------------------
#  Copies the Audio Playground project off OneDrive and onto the
#  local hard drive, then installs a Desktop shortcut that launches
#  the LOCAL copy. Optionally deletes the OneDrive source afterward.
#
#  Defaults:
#    Destination = C:\Users\<you>\Audio-Playground   (always local C: drive)
#
#  Run via:  scripts\Move To Local Drive.bat
#  ...or:    powershell -ExecutionPolicy Bypass -File scripts\Move-To-Local-Drive.ps1
# -----------------------------------------------------------------

[CmdletBinding()]
param(
  [string] $Destination,
  [switch] $RemoveSource
)

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceRoot = Split-Path -Parent $ScriptDir

if (-not $Destination -or $Destination -eq "") {
  $Destination = Join-Path $env:USERPROFILE "Audio-Playground"
}

# Normalize the destination path.
try {
  $Destination = [System.IO.Path]::GetFullPath($Destination)
} catch {
  throw "Invalid destination path: $Destination"
}

Write-Host ""
Write-Host " Audio Playground - Move to Local Drive" -ForegroundColor Cyan
Write-Host " -----------------------------------------------"
Write-Host "  Source:      $SourceRoot"
Write-Host "  Destination: $Destination"
Write-Host ""

# Safety: don't migrate to anywhere inside OneDrive.
if ($Destination -like "*OneDrive*" -or $Destination -like "*onedrive*") {
  throw "Destination is inside OneDrive. Pick a different path (e.g. C:\Audio-Playground)."
}

# If we're already running from the destination, just re-run the shortcut installer.
$srcFull = (Resolve-Path $SourceRoot).Path.TrimEnd('\')
$dstNorm = $Destination.TrimEnd('\')
if ($srcFull -ieq $dstNorm) {
  Write-Host "  Already running from the local destination. Re-installing shortcut..." -ForegroundColor Yellow
  $installer = Join-Path $ScriptDir "Install-Desktop-Shortcut.ps1"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Force
  exit $LASTEXITCODE
}

if (-not (Test-Path $Destination)) {
  try {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  } catch {
    Write-Host ""
    Write-Host "  Could not create $Destination" -ForegroundColor Red
    Write-Host "  (This usually means the path needs admin permission, e.g. C:\ root.)"
    Write-Host "  Falling back to: $env:USERPROFILE\Audio-Playground" -ForegroundColor Yellow
    $Destination = Join-Path $env:USERPROFILE "Audio-Playground"
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  }
}

Write-Host "  Copying project files (excluding node_modules and build caches)..."

# robocopy is fast, robust, and ships with Windows.
$excludeDirs  = @("node_modules", "release", ".git", ".vite", ".cache")
$excludeFiles = @("*.log")

$srcQ = $SourceRoot.TrimEnd('\')
$dstQ = $Destination.TrimEnd('\')

$rcArgs = @(
  "`"$srcQ`"",
  "`"$dstQ`"",
  "/E",        # include subdirs (even empty)
  "/R:1",      # retry once on error
  "/W:1",      # wait 1s between retries
  "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP"
)
$rcArgs += "/XD"
$rcArgs += $excludeDirs | ForEach-Object { "`"$_`"" }
$rcArgs += "/XF"
$rcArgs += $excludeFiles | ForEach-Object { "`"$_`"" }

# Run robocopy via cmd so it doesn't taint $LASTEXITCODE oddly under StrictMode.
$rcLine = "robocopy.exe " + ($rcArgs -join " ")
cmd.exe /c $rcLine | Out-Null
$rc = $LASTEXITCODE

# robocopy exit codes: 0-7 = success (8+ = failure). 1 = files copied OK.
if ($rc -ge 8) {
  throw "robocopy failed with exit code $rc"
}

Write-Host "  Copy complete." -ForegroundColor Green
Write-Host ""

# Re-run the install shortcut from the NEW location so the .lnk points at the local launcher.
$newInstaller = Join-Path $Destination "scripts\Install-Desktop-Shortcut.ps1"
if (-not (Test-Path $newInstaller)) {
  throw "Installer not found at: $newInstaller"
}

Write-Host "  Installing Desktop shortcut pointing at the new local copy..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $newInstaller -Force
$installRc = $LASTEXITCODE
if ($installRc -ne 0) {
  Write-Host "  Shortcut installer reported exit code $installRc" -ForegroundColor Yellow
}

Write-Host ""
Write-Host " ============================================================" -ForegroundColor Green
Write-Host "  Migration complete." -ForegroundColor Green
Write-Host "  Local project:   $Destination" -ForegroundColor Green
Write-Host "  OneDrive copy:   $SourceRoot"
Write-Host " ============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:"
Write-Host "   1. Look for 'Audio Playground' on your Desktop and double-click it."
Write-Host "   2. First launch will install Node deps + build (~1 min)."
Write-Host "   3. Once it works, you can delete the OneDrive copy:"
Write-Host "        $SourceRoot"
Write-Host "      (or re-run this script with -RemoveSource to delete it now)."
Write-Host ""

if ($RemoveSource) {
  Write-Host "  -RemoveSource was passed. Deleting source folder..."
  try {
    Remove-Item -Recurse -Force -Path $SourceRoot
    Write-Host "  Source deleted." -ForegroundColor Green
  } catch {
    Write-Host "  Could not delete source: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "  You can delete it manually from File Explorer."
  }
}
