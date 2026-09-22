#!/usr/bin/env bash
# ============================================================
#  macOS counterpart of get-tools.ps1.
#
#  Downloads the prebuilt reconstruction tools (COLMAP + Brush) into
#  tools/colmap/ and tools/brush/ (both gitignored) so config.js finds them
#  without the large binaries living in git.
#
#    - COLMAP (~80 MB)  photos -> sparse reconstruction. The macOS build has no
#      CUDA, so feature extraction runs on the CPU (config.js detects this).
#    - Brush  (~40 MB)  sparse reconstruction -> trained gaussian splat .ply.
#      Renders through Metal on macOS.
#
#  Both projects only publish Apple Silicon (arm64) macOS builds. On an Intel
#  Mac, install COLMAP with Homebrew (`brew install colmap`) and build Brush
#  from source, then point COLMAP_BIN / BRUSH_BIN at them.
#
#  Usage:  tools/get-tools.sh [--skip-colmap] [--skip-brush]
#          [--colmap-version 4.2.0] [--brush-version v0.3.0]
# ============================================================
set -euo pipefail

COLMAP_VERSION="4.2.0"
BRUSH_VERSION="v0.3.0"
SKIP_COLMAP=0
SKIP_BRUSH=0

while [ $# -gt 0 ]; do
    case "$1" in
        --skip-colmap)    SKIP_COLMAP=1 ;;
        --skip-brush)     SKIP_BRUSH=1 ;;
        --colmap-version) COLMAP_VERSION="$2"; shift ;;
        --brush-version)  BRUSH_VERSION="$2"; shift ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done

if [ "$(uname -s)" != "Darwin" ]; then
    echo "get-tools.sh is for macOS. On Windows use tools/get-tools.ps1." >&2
    exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
    echo "COLMAP and Brush only publish Apple Silicon (arm64) macOS builds." >&2
    echo "On an Intel Mac: brew install colmap, build Brush from source" >&2
    echo "(https://github.com/ArthurBrussee/brush), then set COLMAP_BIN / BRUSH_BIN." >&2
    exit 1
fi

# Resolve tools/ relative to this script, regardless of where it's run from.
TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [ "$SKIP_COLMAP" = "0" ]; then
    url="https://github.com/colmap/colmap/releases/download/$COLMAP_VERSION/colmap-arm64-macos.zip"
    dest="$TOOLS_DIR/colmap"
    echo "Downloading COLMAP $COLMAP_VERSION ..."
    echo "  $url"
    curl -L --fail --progress-bar -o "$TMP_DIR/colmap.zip" "$url"

    # The release zip wraps a second zip holding COLMAP.app. ditto (not unzip)
    # keeps the symlinks inside the app's Qt frameworks intact.
    echo "Extracting to $dest ..."
    rm -rf "$dest" "$TMP_DIR/colmap-outer"
    ditto -x -k "$TMP_DIR/colmap.zip" "$TMP_DIR/colmap-outer"
    inner="$(find "$TMP_DIR/colmap-outer" -name '*.zip' -print -quit)"
    if [ -n "$inner" ]; then
        ditto -x -k "$inner" "$dest"
    else
        mv "$TMP_DIR/colmap-outer" "$dest"
    fi

    colmap_bin="$(find "$dest" -type f -name colmap -path '*/MacOS/*' -print -quit)"
    if [ -z "$colmap_bin" ]; then
        echo "colmap binary not found under $dest after extraction." >&2
        exit 1
    fi
    chmod +x "$colmap_bin"
    echo "COLMAP ready: $colmap_bin"
    echo
fi

if [ "$SKIP_BRUSH" = "0" ]; then
    url="https://github.com/ArthurBrussee/brush/releases/download/$BRUSH_VERSION/brush-app-aarch64-apple-darwin.tar.xz"
    dest="$TOOLS_DIR/brush"
    echo "Downloading Brush $BRUSH_VERSION ..."
    echo "  $url"
    curl -L --fail --progress-bar -o "$TMP_DIR/brush.tar.xz" "$url"

    echo "Extracting to $dest ..."
    rm -rf "$dest"
    mkdir -p "$dest"
    tar -xJf "$TMP_DIR/brush.tar.xz" -C "$dest"

    brush_bin="$(find "$dest" -type f -name 'brush*' ! -name '*.*' -print -quit)"
    if [ -z "$brush_bin" ]; then
        echo "No Brush executable found under $dest after extraction." >&2
        exit 1
    fi
    chmod +x "$brush_bin"
    echo "Brush ready: $brush_bin"
    echo
fi

echo "config.js finds these automatically (it searches tools/colmap and tools/brush)."
echo "To point at copies elsewhere, export COLMAP_BIN / BRUSH_BIN before starting the server."
