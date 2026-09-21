<#
.SYNOPSIS
    Download the prebuilt reconstruction tools (COLMAP + Brush) for Windows into
    tools/colmap/ and tools/brush/ (both gitignored) so the reconstruction server
    can find them, without committing the large binaries to the repository.

.DESCRIPTION
    Two external binaries the pipeline needs but that can't live in git:

      - COLMAP  (~128 MB nocuda / ~380 MB cuda) turns photos into a sparse
        reconstruction. colmap.exe depends on a folder of DLLs (Qt, Ceres, glog,
        FreeImage, and the CUDA runtime on the CUDA build).
      - Brush   (~160 MB) turns COLMAP's sparse reconstruction into a trained
        gaussian splat .ply. It renders with the GPU (wgpu / Vulkan / DX12), so a
        working GPU is required to train - there is no CPU-only build.

    Each developer runs this once. The binaries stay out of git and are found via
    config.js (or the COLMAP_BIN / BRUSH_BIN env vars). At the end it prints the
    env-var values to point the server at both.

.PARAMETER NoCuda
    Download the smaller CPU-only COLMAP build (~128 MB) instead of the default
    CUDA build (~380 MB). Use this only if you do NOT have an NVIDIA GPU. The
    default CUDA build gives GPU feature extraction. (Brush always needs a GPU
    regardless.)

.PARAMETER ColmapVersion
    COLMAP release tag to fetch. Defaults to 4.2.0.

.PARAMETER BrushVersion
    Brush release tag to fetch. Defaults to v0.3.0.

.PARAMETER SkipColmap
    Don't install COLMAP (install Brush only).

.PARAMETER SkipBrush
    Don't install Brush (install COLMAP only).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools/get-tools.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools/get-tools.ps1 -NoCuda
#>
param(
    [switch]$NoCuda,
    [string]$ColmapVersion = "4.2.0",
    [string]$BrushVersion  = "v0.3.0",
    [switch]$SkipColmap,
    [switch]$SkipBrush
)

$ErrorActionPreference = "Stop"

# Resolve tools/ relative to this script, regardless of where it's run from.
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Download a release zip and extract it fresh into tools/<name>, returning the dir.
function Install-Zip {
    param(
        [string]$Name,
        [string]$Url,
        [string]$ZipName
    )

    $destDir = Join-Path $toolsDir $Name
    $zipPath = Join-Path $env:TEMP $ZipName

    Write-Host "Downloading $Name ..." -ForegroundColor Cyan
    Write-Host "  $Url"
    Invoke-WebRequest -Uri $Url -OutFile $zipPath

    Write-Host "Extracting to $destDir ..." -ForegroundColor Cyan
    if (Test-Path $destDir) { Remove-Item -Recurse -Force $destDir }
    Expand-Archive -Path $zipPath -DestinationPath $destDir -Force
    Remove-Item $zipPath -Force

    return $destDir
}

$colmapExe = $null
$brushExe  = $null

if (-not $SkipColmap) {
    $flavor  = if ($NoCuda) { "nocuda" } else { "cuda" }
    $zipName = "colmap-x64-windows-$flavor.zip"
    $url     = "https://github.com/colmap/colmap/releases/download/$ColmapVersion/$zipName"

    Write-Host "COLMAP $ColmapVersion ($flavor)" -ForegroundColor Cyan
    $destDir = Install-Zip -Name "colmap" -Url $url -ZipName $zipName

    # The zip extracts into a subfolder; find colmap.exe wherever it landed.
    $colmapExe = Get-ChildItem -Path $destDir -Recurse -Filter "colmap.exe" | Select-Object -First 1
    if (-not $colmapExe) {
        throw "colmap.exe not found under $destDir after extraction."
    }
    Write-Host "COLMAP ready: $($colmapExe.FullName)" -ForegroundColor Green
    Write-Host ""
}

if (-not $SkipBrush) {
    $zipName = "brush-app-x86_64-pc-windows-msvc.zip"
    $url     = "https://github.com/ArthurBrussee/brush/releases/download/$BrushVersion/$zipName"

    Write-Host "Brush $BrushVersion" -ForegroundColor Cyan
    $destDir = Install-Zip -Name "brush" -Url $url -ZipName $zipName

    # The zip may extract into a subfolder and the exe may be named brush_app.exe;
    # find whichever brush executable landed, wherever it is.
    $brushExe = Get-ChildItem -Path $destDir -Recurse -Filter "*.exe" |
        Where-Object { $_.Name -match "brush" } |
        Select-Object -First 1
    if (-not $brushExe) {
        $brushExe = Get-ChildItem -Path $destDir -Recurse -Filter "*.exe" | Select-Object -First 1
    }
    if (-not $brushExe) {
        throw "No Brush executable found under $destDir after extraction."
    }
    Write-Host "Brush ready: $($brushExe.FullName)" -ForegroundColor Green
    Write-Host ""
}

# config.js finds both automatically (it searches tools/colmap and tools/brush).
Write-Host "config.js finds these automatically (it searches tools/colmap and tools/brush)." -ForegroundColor Yellow
Write-Host "To point at copies elsewhere, set these before starting the server (PowerShell):" -ForegroundColor Yellow
if ($colmapExe) {
    Write-Host "  `$env:COLMAP_BIN = `"$($colmapExe.FullName)`""
    if ($NoCuda) {
        Write-Host "  `$env:COLMAP_USE_GPU = `"0`"   # nocuda build has no GPU SIFT"
    }
}
if ($brushExe) {
    Write-Host "  `$env:BRUSH_BIN = `"$($brushExe.FullName)`""
}
Write-Host "  cd server; npm start"
