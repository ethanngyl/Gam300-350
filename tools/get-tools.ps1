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
      - Brush   (~125 MB) turns COLMAP's sparse reconstruction into a trained
        gaussian splat .ply. It renders with the GPU (wgpu / Vulkan / DX12), so a
        working GPU is required to train - there is no CPU-only build.
        Brush 1.0.0 has no prebuilt release yet, so it is built from source
        (brush-cli at a pinned commit, ~10-15 min). That needs Git and the
        Visual Studio C++ build tools; Rust is installed automatically if
        missing. Older release builds can still be downloaded with
        -BrushVersion v0.3.0.

    Each developer runs this once. The binaries stay out of git and are found via
    config.js (or the COLMAP_BIN / BRUSH_BIN env vars). At the end it prints the
    env-var values to point the server at both.

.PARAMETER NoCuda
    Download the smaller CPU-only COLMAP build (~128 MB) instead of the default
    CUDA build (~380 MB). This is picked automatically when no NVIDIA GPU is
    detected (e.g. AMD / Intel), so it is only needed to force it. The CUDA
    build gives GPU feature extraction. (Brush always needs a GPU regardless,
    but runs on any vendor through Vulkan / DX12.)

.PARAMETER ColmapVersion
    COLMAP release tag to fetch. Defaults to 4.0.4.

.PARAMETER BrushVersion
    Brush version to install. Defaults to 1.0.0, built from source at
    -BrushCommit. A release tag starting with "v" (e.g. v0.3.0) downloads
    that prebuilt release instead.

.PARAMETER BrushCommit
    The Brush commit built for 1.0.0. Pinned so every machine trains with the
    same Brush (--alpha-mode, which the masked-background training needs, is
    1.0+ only).

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
    [string]$ColmapVersion = "4.0.4",
    [string]$BrushVersion  = "1.0.0",
    [string]$BrushCommit   = "1388f74c6fe0236f68ee4915564bf00e9d2e3747",
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

# Build brush-cli from source at $Commit and put the exe in tools/brush,
# returning the exe. Installs Rust (rustup, per-user) if cargo is missing.
function Install-BrushFromSource {
    param([string]$Commit)

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "Git is needed to build Brush. Install it from https://git-scm.com and run this again."
    }

    # Rust on Windows links with the MSVC linker from Visual Studio.
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    $vcTools = $null
    if (Test-Path $vswhere) {
        $vcTools = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    }
    if (-not $vcTools) {
        throw "The Visual Studio C++ build tools are needed to build Brush. Install Visual Studio (or the Build Tools) with the 'Desktop development with C++' workload, then run this again."
    }

    $cargo = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
    if (-not (Test-Path $cargo)) {
        $onPath = Get-Command cargo -ErrorAction SilentlyContinue
        if ($onPath) { $cargo = $onPath.Source }
    }
    if (-not (Test-Path $cargo)) {
        Write-Host "Installing Rust (rustup, for this user only) ..." -ForegroundColor Cyan
        $rustupInit = Join-Path $env:TEMP "rustup-init.exe"
        Invoke-WebRequest -Uri "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" -OutFile $rustupInit
        & $rustupInit -y --profile minimal --default-toolchain stable
        if ($LASTEXITCODE -ne 0) { throw "Rust install failed (rustup-init exit code $LASTEXITCODE)." }
        Remove-Item $rustupInit -Force
        $cargo = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
    }

    # Fetch only the pinned commit, into a gitignored working folder.
    $srcDir = Join-Path $toolsDir "brush-src"
    Write-Host "Fetching Brush source at $Commit ..." -ForegroundColor Cyan
    if (-not (Test-Path (Join-Path $srcDir ".git"))) {
        if (Test-Path $srcDir) { Remove-Item -Recurse -Force $srcDir }
        git init --quiet $srcDir
        git -C $srcDir remote add origin https://github.com/ArthurBrussee/brush.git
    }
    git -C $srcDir fetch --quiet --depth 1 origin $Commit
    if ($LASTEXITCODE -ne 0) { throw "Could not fetch Brush commit $Commit." }
    git -C $srcDir checkout --quiet --force FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw "Could not check out Brush commit $Commit." }

    # --locked uses Brush's own Cargo.lock, so every machine gets the same
    # dependency versions.
    Write-Host "Building Brush (release) - about 10-15 minutes the first time ..." -ForegroundColor Cyan
    Push-Location $srcDir
    try {
        & $cargo build --release --locked -p brush-cli
        if ($LASTEXITCODE -ne 0) { throw "Brush build failed (cargo exit code $LASTEXITCODE)." }
    }
    finally {
        Pop-Location
    }

    $destDir = Join-Path $toolsDir "brush"
    if (Test-Path $destDir) { Remove-Item -Recurse -Force $destDir }
    New-Item -ItemType Directory -Path $destDir | Out-Null
    Copy-Item (Join-Path $srcDir "target\release\brush-cli.exe") $destDir

    # The build folder is several GB; only the exe is needed.
    Remove-Item -Recurse -Force $srcDir

    return Get-Item (Join-Path $destDir "brush-cli.exe")
}

$colmapExe = $null
$brushExe  = $null

if (-not $SkipColmap) {
    # CUDA only runs on NVIDIA GPUs. If -NoCuda wasn't passed, pick the build
    # from the installed adapters so AMD / Intel machines get the nocuda build.
    if (-not $NoCuda) {
        $gpus = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty Name)
        Write-Host "Detected GPU(s): $($gpus -join ', ')"
        if (-not ($gpus -match "NVIDIA")) {
            Write-Host "No NVIDIA GPU found - using the CPU-only (nocuda) COLMAP build." -ForegroundColor Yellow
            $NoCuda = $true
        }
    }

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

if (-not $SkipBrush -and -not $BrushVersion.StartsWith("v")) {
    Write-Host "Brush $BrushVersion (built from source)" -ForegroundColor Cyan
    $brushExe = Install-BrushFromSource -Commit $BrushCommit
    Write-Host "Brush ready: $($brushExe.FullName)" -ForegroundColor Green
    Write-Host ""
}
elseif (-not $SkipBrush) {
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
