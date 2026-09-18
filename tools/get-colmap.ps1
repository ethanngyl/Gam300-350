<#
.SYNOPSIS
    Download a prebuilt COLMAP for Windows into tools/colmap/ (gitignored) so the
    reconstruction server can find it, without committing the ~130 MB binary to
    the repository.

.DESCRIPTION
    COLMAP's colmap.exe cannot run on its own -- it depends on a folder of DLLs
    (Qt, Ceres, glog, FreeImage, and the CUDA runtime on the CUDA build). This
    script downloads the official release zip and extracts it locally. Each
    developer runs it once; the binary stays out of git.

    After it finishes, it prints the COLMAP_BIN value to point the server at.

.PARAMETER Cuda
    Download the larger CUDA build (~380 MB, needs an NVIDIA GPU) instead of the
    default CPU-only build (~128 MB). Use this only if you have CUDA and want GPU
    feature extraction.

.PARAMETER Version
    COLMAP release tag to fetch. Defaults to 4.2.0.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools/get-colmap.ps1
#>
param(
    [switch]$Cuda,
    [string]$Version = "4.2.0"
)

$ErrorActionPreference = "Stop"

$flavor  = if ($Cuda) { "cuda" } else { "nocuda" }
$zipName = "colmap-x64-windows-$flavor.zip"
$url     = "https://github.com/colmap/colmap/releases/download/$Version/$zipName"

# Resolve tools/colmap relative to this script, regardless of where it's run from.
$toolsDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$destDir   = Join-Path $toolsDir "colmap"
$zipPath   = Join-Path $env:TEMP $zipName

Write-Host "Downloading COLMAP $Version ($flavor) ..." -ForegroundColor Cyan
Write-Host "  $url"
Invoke-WebRequest -Uri $url -OutFile $zipPath

Write-Host "Extracting to $destDir ..." -ForegroundColor Cyan
if (Test-Path $destDir) { Remove-Item -Recurse -Force $destDir }
Expand-Archive -Path $zipPath -DestinationPath $destDir -Force
Remove-Item $zipPath -Force

# The zip extracts into a subfolder; find colmap.exe wherever it landed.
$exe = Get-ChildItem -Path $destDir -Recurse -Filter "colmap.exe" | Select-Object -First 1
if (-not $exe) {
    throw "colmap.exe not found under $destDir after extraction."
}

Write-Host ""
Write-Host "COLMAP ready:" -ForegroundColor Green
Write-Host "  $($exe.FullName)"
Write-Host ""
Write-Host "config.js finds this automatically (it searches tools/colmap)." -ForegroundColor Yellow
Write-Host "Restart the backend to pick it up:" -ForegroundColor Yellow
Write-Host "  cd packages/src/backend; node server.js"
Write-Host ""
Write-Host "To point at a copy elsewhere instead, set COLMAP_BIN:" -ForegroundColor DarkGray
Write-Host "  `$env:COLMAP_BIN = `"$($exe.FullName)`""
if (-not $Cuda) {
    Write-Host "  (GPU SIFT is auto-disabled for the nocuda build; override with COLMAP_USE_GPU)" -ForegroundColor DarkGray
}
