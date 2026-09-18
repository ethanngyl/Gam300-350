<#
.SYNOPSIS
    Download a prebuilt Brush (gaussian-splat trainer) for Windows into
    tools/brush/ (gitignored) so the reconstruction server can find it, without
    committing the ~160 MB binary to the repository.

.DESCRIPTION
    Brush turns COLMAP's sparse reconstruction into a trained gaussian splat
    .ply. Like COLMAP, it ships as a zip of an executable plus support files, so
    it can't be committed to git. Each developer runs this once; the binary
    stays out of the repo and is found via config.js (or the BRUSH_BIN env var).

    Brush renders with the GPU (wgpu / Vulkan / DX12), so a working GPU is
    required to train - there is no CPU-only build.

.PARAMETER Version
    Brush release tag to fetch. Defaults to v0.3.0.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools/get-brush.ps1
#>
param(
    [string]$Version = "v0.3.0"
)

$ErrorActionPreference = "Stop"

$zipName = "brush-app-x86_64-pc-windows-msvc.zip"
$url     = "https://github.com/ArthurBrussee/brush/releases/download/$Version/$zipName"

# Resolve tools/brush relative to this script, regardless of where it's run from.
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$destDir  = Join-Path $toolsDir "brush"
$zipPath  = Join-Path $env:TEMP $zipName

Write-Host "Downloading Brush $Version ..." -ForegroundColor Cyan
Write-Host "  $url"
Invoke-WebRequest -Uri $url -OutFile $zipPath

Write-Host "Extracting to $destDir ..." -ForegroundColor Cyan
if (Test-Path $destDir) { Remove-Item -Recurse -Force $destDir }
Expand-Archive -Path $zipPath -DestinationPath $destDir -Force
Remove-Item $zipPath -Force

# The zip may extract into a subfolder and the exe may be named brush_app.exe;
# find whichever brush executable landed, wherever it is.
$exe = Get-ChildItem -Path $destDir -Recurse -Filter "*.exe" |
    Where-Object { $_.Name -match "brush" } |
    Select-Object -First 1
if (-not $exe) {
    $exe = Get-ChildItem -Path $destDir -Recurse -Filter "*.exe" | Select-Object -First 1
}
if (-not $exe) {
    throw "No Brush executable found under $destDir after extraction."
}

Write-Host ""
Write-Host "Brush ready:" -ForegroundColor Green
Write-Host "  $($exe.FullName)"
Write-Host ""
Write-Host "config.js finds this automatically (it searches tools/brush)." -ForegroundColor Yellow
Write-Host "Restart the server to pick it up:" -ForegroundColor Yellow
Write-Host "  cd server; npm start"
Write-Host ""
Write-Host "To point at a copy elsewhere instead, set BRUSH_BIN:" -ForegroundColor DarkGray
Write-Host "  `$env:BRUSH_BIN = `"$($exe.FullName)`""
