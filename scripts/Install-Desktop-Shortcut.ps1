# Install-Desktop-Shortcut.ps1
# -----------------------------------------------------------------
#  Generates a custom neon icon and installs a Desktop shortcut
#  that launches Kill-Chain.
#
#  Run via:  scripts\Install Desktop Shortcut.bat
#  ...or:    powershell -ExecutionPolicy Bypass -File scripts\Install-Desktop-Shortcut.ps1
#
#  NOTE: this file is intentionally ASCII-only so it parses correctly
#  under Windows PowerShell 5 regardless of system codepage.
# -----------------------------------------------------------------

[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$ScriptDir        = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot      = Split-Path -Parent $ScriptDir
$AssetsDir        = Join-Path $ProjectRoot "assets"
$PngPath          = Join-Path $AssetsDir "icon.png"
$IcoPath          = Join-Path $AssetsDir "icon.ico"
$LauncherBat      = Join-Path $ScriptDir "Launch Audio Playground.bat"
$LauncherVbs      = Join-Path $ScriptDir "Launch Audio Playground.vbs"
$DebugLauncherBat = Join-Path $ScriptDir "Launch Audio Playground (Debug).bat"
$WScriptExe       = Join-Path $env:WINDIR "System32\wscript.exe"

if (-not (Test-Path $AssetsDir)) {
  New-Item -ItemType Directory -Path $AssetsDir | Out-Null
}

if (-not (Test-Path $LauncherBat)) {
  throw "Launcher batch file not found at: $LauncherBat"
}

Add-Type -AssemblyName System.Drawing

# -----------------------------------------------------------------
#  Procedural icon: glowing concentric rings + tick marks + center dot
#  on a rounded gunmetal panel with a tactical gradient border.
#  Palette: tactical green + olive steel + tracer amber. Military vibe.
# -----------------------------------------------------------------
function New-AudioPlaygroundIcon {
  param(
    [Parameter(Mandatory)] [string] $Path,
    [int] $Size = 512
  )

  $pixFmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  $bmp = [System.Drawing.Bitmap]::new($Size, $Size, $pixFmt)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $cornerR = [int]($Size * 0.18)

  function New-RoundedRectPath {
    param([int]$x, [int]$y, [int]$w, [int]$h, [int]$r)
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x,             $y,             $r * 2, $r * 2, 180, 90) | Out-Null
    $p.AddArc($x + $w - $r*2, $y,             $r * 2, $r * 2, 270, 90) | Out-Null
    $p.AddArc($x + $w - $r*2, $y + $h - $r*2, $r * 2, $r * 2,   0, 90) | Out-Null
    $p.AddArc($x,             $y + $h - $r*2, $r * 2, $r * 2,  90, 90) | Out-Null
    $p.CloseFigure()
    return $p
  }

  $bgPath = New-RoundedRectPath 0 0 $Size $Size $cornerR

  # Background: rounded panel with soft radial-style gradient.
  $bgBrush = [System.Drawing.Drawing2D.PathGradientBrush]::new($bgPath)
  $centerF = [float]($Size * 0.5)
  $bgBrush.CenterPoint    = [System.Drawing.PointF]::new($centerF, $centerF)
  $bgBrush.CenterColor    = [System.Drawing.Color]::FromArgb(255, 18, 28, 20)
  $bgBrush.SurroundColors = ,([System.Drawing.Color]::FromArgb(255, 5, 8, 6))
  $g.FillPath($bgBrush, $bgPath)
  $bgBrush.Dispose()

  # Subtle top highlight for glass feel.
  # Pre-compute the height to dodge a Windows PowerShell 5 parser quirk
  # where inline [int](...) casts inside command-mode comma lists can
  # leak the parenthesized value as a stray positional argument.
  $highlightH = [int]($Size * 0.45)
  $hiColor1   = [System.Drawing.Color]::FromArgb(40, 255, 255, 255)
  $hiColor2   = [System.Drawing.Color]::FromArgb(0,  255, 255, 255)
  $highlightRect = [System.Drawing.Rectangle]::new(0, 0, $Size, $highlightH)
  $hiBrush       = [System.Drawing.Drawing2D.LinearGradientBrush]::new($highlightRect, $hiColor1, $hiColor2, [float]90.0)
  $g.FillPath($hiBrush, $bgPath)
  $hiBrush.Dispose()

  # Tactical gradient border (green -> olive steel -> tracer amber).
  $sizeF       = [float]$Size
  $borderRect  = [System.Drawing.RectangleF]::new([float]0, [float]0, $sizeF, $sizeF)
  $borderC1    = [System.Drawing.Color]::FromArgb(255, 120, 198, 120)
  $borderC2    = [System.Drawing.Color]::FromArgb(255, 224, 138, 56)
  $borderBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($borderRect, $borderC1, $borderC2, [float]45.0)
  $blend       = [System.Drawing.Drawing2D.ColorBlend]::new(3)
  $blend.Colors = @(
    [System.Drawing.Color]::FromArgb(255, 120, 198, 120),
    [System.Drawing.Color]::FromArgb(255, 120, 150, 96),
    [System.Drawing.Color]::FromArgb(255, 224, 138, 56)
  )
  $blend.Positions = @([float]0.0, [float]0.5, [float]1.0)
  $borderBrush.InterpolationColors = $blend
  $borderW   = [float]($Size * 0.018)
  $borderPen = [System.Drawing.Pen]::new($borderBrush, $borderW)
  $g.DrawPath($borderPen, $bgPath)
  $borderPen.Dispose()
  $borderBrush.Dispose()

  # Three glowing concentric rings.
  $cx = [float]($Size / 2)
  $cy = [float]($Size / 2)
  $ringRadii  = @(0.16, 0.26, 0.36)
  $ringColors = @(
    [System.Drawing.Color]::FromArgb(255, 224, 138, 56),
    [System.Drawing.Color]::FromArgb(255, 120, 150, 96),
    [System.Drawing.Color]::FromArgb(255, 120, 198, 120)
  )

  for ($i = 0; $i -lt 3; $i++) {
    $r   = [float]($Size * $ringRadii[$i])
    $col = $ringColors[$i]

    for ($j = 5; $j -ge 1; $j--) {
      $alpha = [int](28 - $j * 4)
      if ($alpha -lt 6) { $alpha = 6 }
      $glowCol = [System.Drawing.Color]::FromArgb($alpha, $col.R, $col.G, $col.B)
      $w = [float]($Size * 0.018 + $j * $Size * 0.010)
      $glowPen = [System.Drawing.Pen]::new($glowCol, $w)
      $g.DrawEllipse($glowPen, $cx - $r, $cy - $r, $r * 2, $r * 2)
      $glowPen.Dispose()
    }

    $ringW   = [float]($Size * 0.012)
    $ringPen = [System.Drawing.Pen]::new($col, $ringW)
    $g.DrawEllipse($ringPen, $cx - $r, $cy - $r, $r * 2, $r * 2)
    $ringPen.Dispose()
  }

  # Tick marks around the outermost ring (instrument feel).
  $tickInnerR    = [float]($Size * 0.41)
  $tickOuterR    = [float]($Size * 0.445)
  $tickBigInnerR = [float]($Size * 0.39)
  $tickC1     = [System.Drawing.Color]::FromArgb(170, 230, 230, 255)
  $tickC2     = [System.Drawing.Color]::FromArgb(220, 255, 255, 255)
  $tickW1     = [float]($Size * 0.006)
  $tickW2     = [float]($Size * 0.010)
  $tickPen    = [System.Drawing.Pen]::new($tickC1, $tickW1)
  $tickPenBig = [System.Drawing.Pen]::new($tickC2, $tickW2)
  for ($k = 0; $k -lt 24; $k++) {
    $ang   = [Math]::PI * 2 * $k / 24 - [Math]::PI / 2
    $isMain = ($k % 6) -eq 0
    if ($isMain) {
      $iR = $tickBigInnerR
      $pen = $tickPenBig
    } else {
      $iR = $tickInnerR
      $pen = $tickPen
    }
    $x1 = $cx + [Math]::Cos($ang) * $iR
    $y1 = $cy + [Math]::Sin($ang) * $iR
    $x2 = $cx + [Math]::Cos($ang) * $tickOuterR
    $y2 = $cy + [Math]::Sin($ang) * $tickOuterR
    $g.DrawLine($pen, $x1, $y1, $x2, $y2)
  }
  $tickPen.Dispose()
  $tickPenBig.Dispose()

  # Center glowing dot.
  $dotR = [float]($Size * 0.045)
  for ($j = 6; $j -ge 1; $j--) {
    $alpha = [int](42 - $j * 6)
    if ($alpha -lt 8) { $alpha = 8 }
    $glowCol = [System.Drawing.Color]::FromArgb($alpha, 255, 200, 120)
    $r2 = $dotR + [float]($j * $Size * 0.008)
    $brush = [System.Drawing.SolidBrush]::new($glowCol)
    $g.FillEllipse($brush, $cx - $r2, $cy - $r2, $r2 * 2, $r2 * 2)
    $brush.Dispose()
  }
  $coreColor = [System.Drawing.Color]::FromArgb(255, 255, 238, 210)
  $coreBrush = [System.Drawing.SolidBrush]::new($coreColor)
  $g.FillEllipse($coreBrush, $cx - $dotR, $cy - $dotR, $dotR * 2, $dotR * 2)
  $coreBrush.Dispose()

  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# -----------------------------------------------------------------
#  Convert a single PNG into a multi-resolution .ico using
#  PNG-encoded sub-images (valid for Vista+ icon format).
# -----------------------------------------------------------------
function Convert-PngToMultiIco {
  param(
    [Parameter(Mandatory)] [string] $PngPath,
    [Parameter(Mandatory)] [string] $IcoPath
  )

  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $srcImg = [System.Drawing.Image]::FromFile($PngPath)
  $pixFmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb

  $ms = [System.IO.MemoryStream]::new()
  $bw = [System.IO.BinaryWriter]::new($ms)

  # ICONDIR header.
  $bw.Write([UInt16]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]$sizes.Count)

  $imageData = New-Object 'System.Collections.Generic.List[byte[]]'
  $offset = 6 + 16 * $sizes.Count

  foreach ($s in $sizes) {
    $bmp = [System.Drawing.Bitmap]::new($s, $s, $pixFmt)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($srcImg, 0, 0, $s, $s)
    $g.Dispose()

    $imgMs = [System.IO.MemoryStream]::new()
    $bmp.Save($imgMs, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $bytes = $imgMs.ToArray()
    $imgMs.Dispose()
    $imageData.Add($bytes) | Out-Null

    if ($s -ge 256) { $w = 0 } else { $w = $s }
    if ($s -ge 256) { $h = 0 } else { $h = $s }
    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $bytes.Length
  }

  foreach ($bytes in $imageData) { $bw.Write($bytes) }

  [System.IO.File]::WriteAllBytes($IcoPath, $ms.ToArray())
  $bw.Dispose()
  $ms.Dispose()
  $srcImg.Dispose()
}

# -----------------------------------------------------------------
#  Pipeline
# -----------------------------------------------------------------
Write-Host ""
Write-Host " Kill-Chain - Desktop installer" -ForegroundColor Cyan
Write-Host " -------------------------------------------"

if ($Force -or -not (Test-Path $PngPath)) {
  Write-Host "  [1/3] Drawing icon (512x512 procedural tactical)..."
  New-AudioPlaygroundIcon -Path $PngPath -Size 512
} else {
  Write-Host "  [1/3] Reusing existing icon.png  (pass -Force to redraw)"
}

Write-Host "  [2/3] Baking multi-size icon.ico ..."
Convert-PngToMultiIco -PngPath $PngPath -IcoPath $IcoPath

$shellDesktop = [Environment]::GetFolderPath("Desktop")
$localDesktop = Join-Path $env:USERPROFILE "Desktop"
$desktopIsOneDrive = $shellDesktop -like "*OneDrive*" -or $shellDesktop -like "*onedrive*"

# Always write a shortcut at the OS-reported Desktop (that's what the
# user *sees* on their desktop), and ALSO at $env:USERPROFILE\Desktop
# if it exists and is different (so the icon survives if the user later
# disables OneDrive's Desktop backup).
$shortcutTargets = New-Object System.Collections.Generic.List[string]
$shortcutTargets.Add((Join-Path $shellDesktop "Kill-Chain.lnk")) | Out-Null
if ((Test-Path $localDesktop) -and ($localDesktop.TrimEnd('\') -ne $shellDesktop.TrimEnd('\'))) {
  $shortcutTargets.Add((Join-Path $localDesktop "Kill-Chain.lnk")) | Out-Null
}

# Remove shortcuts left behind by previous names so the desktop doesn't end up
# with duplicate icons after the rebrand.
$desktopsToClean = @($shellDesktop, $localDesktop) | Select-Object -Unique
$staleNames = @(
  "Audio Playground.lnk",  "Audio Playground (Debug).lnk",
  "Warpath Audio.lnk",     "Warpath Audio (Debug).lnk",
  "Pulse-Fire Audio.lnk",  "Pulse-Fire Audio (Debug).lnk",
  "Pulse-Fire.lnk",        "Pulse-Fire (Debug).lnk"
)
foreach ($dt in $desktopsToClean) {
  if (-not (Test-Path $dt)) { continue }
  foreach ($name in $staleNames) {
    $old = Join-Path $dt $name
    if (Test-Path $old) {
      try { Remove-Item $old -Force -ErrorAction Stop; Write-Host "        Removed old shortcut: $old" -ForegroundColor DarkGray }
      catch { Write-Host "        Could not remove old shortcut: $old" -ForegroundColor Yellow }
    }
  }
}

Write-Host "  [3/3] Writing Desktop shortcut(s)..."
$wsh = New-Object -ComObject WScript.Shell

function New-PlaygroundShortcut {
  param(
    [string] $Path,
    [string] $Target,
    [string] $Description,
    [string] $Arguments = ""
  )
  try {
    $sc = $wsh.CreateShortcut($Path)
    $sc.TargetPath       = $Target
    if ($Arguments -ne "") { $sc.Arguments = $Arguments }
    $sc.WorkingDirectory = $ProjectRoot
    $sc.IconLocation     = "$IcoPath,0"
    $sc.Description      = $Description
    $sc.WindowStyle      = 1
    $sc.Save()
    if (Test-Path $Path) {
      $sz = (Get-Item $Path).Length
      Write-Host "        OK  -> $Path  ($sz bytes)" -ForegroundColor Green
      return $true
    } else {
      Write-Host "        FAIL -> $Path  (save returned but file is missing)" -ForegroundColor Red
      return $false
    }
  } catch {
    Write-Host "        FAIL -> $Path" -ForegroundColor Red
    Write-Host "        Reason: $($_.Exception.Message)" -ForegroundColor Red
    return $false
  }
}

# Prefer the windowless VBS entry point (launches with NO console window on
# normal runs) when both wscript.exe and the VBS are present. Fall back to the
# .bat directly if not.
$useVbs = (Test-Path $LauncherVbs) -and (Test-Path $WScriptExe)

$writtenCount = 0
foreach ($shortcutPath in $shortcutTargets) {
  if ($useVbs) {
    $ok = New-PlaygroundShortcut -Path $shortcutPath -Target $WScriptExe -Arguments ('"{0}"' -f $LauncherVbs) -Description "Kill Chain — universal Windows audio engine"
  } else {
    $ok = New-PlaygroundShortcut -Path $shortcutPath -Target $LauncherBat -Description "Kill Chain — universal Windows audio engine"
  }
  if ($ok) { $writtenCount++ }
}

if ($writtenCount -eq 0) {
  throw "Could not write the Desktop shortcut to any of the candidate locations."
}

# Also install a "(Debug)" shortcut next to the main one so the user can
# diagnose silent failures without spelunking into the scripts folder.
if (Test-Path $DebugLauncherBat) {
  Write-Host ""
  Write-Host "        Installing companion Debug shortcut..."
  foreach ($shortcutPath in $shortcutTargets) {
    $debugPath = $shortcutPath -replace 'Kill-Chain\.lnk$', 'Kill-Chain (Debug).lnk'
    [void](New-PlaygroundShortcut -Path $debugPath -Target $DebugLauncherBat -Description "Kill-Chain - debug launcher (foreground console, stays open)")
  }
}

# Refresh shell icon cache so the new icon shows up immediately.
try {
  $code = @"
using System;
using System.Runtime.InteropServices;
public static class Shell32Notify {
  [DllImport("shell32.dll", CharSet = CharSet.Auto)]
  public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@
  if (-not ([System.Management.Automation.PSTypeName]'Shell32Notify').Type) {
    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
  }
  [Shell32Notify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
} catch { }

Write-Host ""
Write-Host " ============================================================" -ForegroundColor Green
Write-Host "  Shortcut installed." -ForegroundColor Green
Write-Host "  Target launcher: $LauncherBat"
Write-Host "  Project root:    $ProjectRoot"
Write-Host " ============================================================" -ForegroundColor Green

if ($desktopIsOneDrive) {
  Write-Host ""
  Write-Host " NOTE: Your Windows Desktop is currently redirected to OneDrive:" -ForegroundColor Yellow
  Write-Host "   $shellDesktop"
  Write-Host " The .lnk file lands there because that IS your visible Desktop."
  Write-Host " The shortcut *targets* the local launcher above, so launching"
  Write-Host " the app never touches OneDrive."
  Write-Host ""
  Write-Host " To move the .lnk out of OneDrive entirely, open:"
  Write-Host "   Settings -> Accounts -> Windows backup -> OneDrive folder syncing"
  Write-Host " ...and turn OFF Desktop. Windows will then use $localDesktop instead."
}

Write-Host ""
Write-Host " First launch will install Node.js (if missing) + npm deps + build (~1 min)."
Write-Host " Subsequent launches open the app almost instantly."
Write-Host ""
