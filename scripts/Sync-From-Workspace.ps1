[CmdletBinding()]
param(
  [string]$Source = (Split-Path -Parent (Split-Path -Parent $PSCommandPath)),
  [string]$Destination = "$env:USERPROFILE\Audio-Playground"
)

# -----------------------------------------------------------------------------
#  Sync-From-Workspace.ps1
#
#  Copies the source-of-truth folders (src/, electron/, scripts/, and the
#  top-level config files) from the OneDrive workspace into the local install
#  at C:\Users\<you>\Audio-Playground so the running app picks up edits.
#
#  Does NOT touch node_modules, dist/, dist-electron/, release/, or .git/.
#  Safe to run repeatedly. After a sync, run "Rebuild and Relaunch.bat" in
#  the destination folder to build & launch with the new code.
# -----------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

function Write-Section($Text) {
  Write-Host ""
  Write-Host "===== $Text =====" -ForegroundColor Cyan
}

Write-Section "Audio Playground - sync from workspace"
Write-Host "  Source     : $Source"
Write-Host "  Destination: $Destination"

if (-not (Test-Path -LiteralPath $Source)) {
  throw "Source not found: $Source"
}
if (-not (Test-Path -LiteralPath $Destination)) {
  throw "Destination not found: $Destination - run scripts\Move To Local Drive.bat first."
}

$folders = @("src", "electron", "scripts")
foreach ($f in $folders) {
  $from = Join-Path $Source $f
  $to   = Join-Path $Destination $f
  if (-not (Test-Path -LiteralPath $from)) { continue }
  Write-Section "Mirroring $f"
  $args = @(
    $from, $to, "/MIR",
    "/XD", "node_modules", "dist", "dist-electron", "release", ".git",
    "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/NC"
  )
  & robocopy.exe @args | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy reported error code $LASTEXITCODE while mirroring $f"
  }
}

# Top-level files that affect builds.
$files = @(
  "package.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "tsconfig.electron.json",
  "vite.config.ts",
  "tailwind.config.cjs",
  "postcss.config.cjs",
  "index.html",
  "README.md"
)

Write-Section "Copying top-level config files"
foreach ($file in $files) {
  $from = Join-Path $Source $file
  $to   = Join-Path $Destination $file
  if (Test-Path -LiteralPath $from) {
    Copy-Item -LiteralPath $from -Destination $to -Force
    Write-Host "  ok  $file"
  }
}

Write-Section "Done"
Write-Host "Now run: $Destination\scripts\Rebuild and Relaunch.bat" -ForegroundColor Green
