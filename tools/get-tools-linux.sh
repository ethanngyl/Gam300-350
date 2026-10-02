#!/usr/bin/env bash
# ============================================================
#  Linux / Ubuntu counterpart of get-tools.sh (macOS) and get-tools.ps1.
#
#  Makes the reconstruction tools (COLMAP + Brush) available so the backend's
#  config.js finds them without the large binaries living in git.
#
#    - COLMAP  photos -> sparse reconstruction. There is no standalone prebuilt
#      Linux binary in the COLMAP releases, so on Ubuntu it is installed from
#      the distro repo (apt install colmap) onto the PATH, where config.js's
#      findOnPath() picks it up. The packaged COLMAP is CPU-only on most
#      systems; config.js probes for CUDA at runtime and falls back to the CPU.
#    - Brush (~40 MB)  sparse reconstruction -> trained gaussian splat .ply.
#      The project publishes an x86_64 Linux build; it is unpacked into
#      tools/brush/ (gitignored). Renders through Vulkan on Linux.
#
#  Brush only publishes an x86_64 (x86_64-unknown-linux-gnu) Linux build. On
#  arm64 Linux, build Brush from source (https://github.com/ArthurBrussee/brush)
#  and point BRUSH_BIN at it.
#
#  Usage:  tools/get-tools-linux.sh [--skip-colmap] [--skip-brush]
#          [--brush-version v0.3.0]
# ============================================================
set -euo pipefail

BRUSH_VERSION="v0.3.0"
SKIP_COLMAP=0
SKIP_BRUSH=0

while [ $# -gt 0 ]; do
    case "$1" in
        --skip-colmap)   SKIP_COLMAP=1 ;;
        --skip-brush)    SKIP_BRUSH=1 ;;
        --brush-version) BRUSH_VERSION="$2"; shift ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done

if [ "$(uname -s)" != "Linux" ]; then
    echo "get-tools-linux.sh is for Linux. On macOS use tools/get-tools.sh, on Windows tools/get-tools.ps1." >&2
    exit 1
fi

# Resolve tools/ relative to this script, regardless of where it's run from.
TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# ---- COLMAP (apt) ---------------------------------------------------------
# No prebuilt standalone Linux binary ships in the COLMAP releases, so install
# the distro package. It lands on the PATH; config.js's findOnPath() resolves
# it. Needs sudo and the universe repo (enabled by default on Ubuntu Desktop).
if [ "$SKIP_COLMAP" = "0" ]; then
    if command -v colmap >/dev/null 2>&1; then
        echo "COLMAP already on PATH: $(command -v colmap)"
    elif command -v apt-get >/dev/null 2>&1; then
        echo "Installing COLMAP from the distro repo (apt install colmap) ..."
        # Use sudo only when not already root (e.g. inside a container).
        SUDO=""
        if [ "$(id -u)" != "0" ]; then SUDO="sudo"; fi
        $SUDO apt-get update
        $SUDO apt-get install -y colmap
        echo "COLMAP ready: $(command -v colmap)"
    else
        echo "No colmap on PATH and apt-get is unavailable." >&2
        echo "Install COLMAP with your package manager (or build it), then set COLMAP_BIN." >&2
        exit 1
    fi
    echo
fi

# ---- Brush (GitHub release tarball) --------------------------------------
if [ "$SKIP_BRUSH" = "0" ]; then
    if [ "$(uname -m)" != "x86_64" ]; then
        echo "Brush only publishes an x86_64 Linux build (this machine is $(uname -m))." >&2
        echo "Build Brush from source (https://github.com/ArthurBrussee/brush) and set BRUSH_BIN." >&2
        exit 1
    fi

    url="https://github.com/ArthurBrussee/brush/releases/download/$BRUSH_VERSION/brush-app-x86_64-unknown-linux-gnu.tar.xz"
    dest="$TOOLS_DIR/brush"
    echo "Downloading Brush $BRUSH_VERSION ..."
    echo "  $url"
    curl -L --fail --progress-bar -o "$TMP_DIR/brush.tar.xz" "$url"

    echo "Extracting to $dest ..."
    rm -rf "$dest"
    mkdir -p "$dest"
    tar -xJf "$TMP_DIR/brush.tar.xz" -C "$dest"

    # The archive's executable has no extension (brush_app / brush). Match the
    # same way config.js does (/^brush[\w-]*$/) and skip any dotted files.
    brush_bin="$(find "$dest" -type f -name 'brush*' ! -name '*.*' -print -quit)"
    if [ -z "$brush_bin" ]; then
        echo "No Brush executable found under $dest after extraction." >&2
        exit 1
    fi
    chmod +x "$brush_bin"
    echo "Brush ready: $brush_bin"
    echo
fi

echo "config.js finds these automatically (COLMAP on PATH, Brush in tools/brush)."
echo "To point at copies elsewhere, export COLMAP_BIN / BRUSH_BIN before starting the server."
