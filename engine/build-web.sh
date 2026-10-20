#!/usr/bin/env bash
# ============================================================
#  Codefine Engine - Web (WebAssembly) build (macOS / Linux
#  counterpart of build-web.bat)
#
#  Builds the engine renderer for the browser and drops
#  codefine-engine.js / codefine-engine.wasm into
#  packages/src/web-app/public/engine, where the web app's viewer
#  picks it up. Re-run after changing anything in src/splat,
#  src/gfx or web/. The first run downloads the Emscripten SDK
#  into Library/emsdk (gitignored, a few hundred MB).
#
#  Needs git, python3 and cmake on the PATH
#  (macOS: brew install cmake   Ubuntu: sudo apt install cmake git python3).
#  Written for the bash 3.2 that ships with macOS.
# ============================================================

set -u
cd "$(dirname "$0")" || exit 1

fail() {
    echo
    echo "*** $1 ***"
    exit 1
}

echo "========================================"
echo "Codefine Engine - Web (WebAssembly) build"
echo "========================================"

# Keep in sync with CF_EMSDK_VERSION in build-web.bat and the Dockerfile.
# (Not named EMSDK_*: emsdk's own environment script owns those names.)
CF_EMSDK_VERSION="4.0.10"
CF_EMSDK_DIR="Library/emsdk"

for tool in git python3 cmake; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool not found - install it, then run this again."
done

if [ ! -f "$CF_EMSDK_DIR/emsdk" ]; then
    echo "Emscripten SDK not found. Downloading it into $CF_EMSDK_DIR..."
    echo "This is a one-time download of several hundred MB."
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$CF_EMSDK_DIR" ||
        fail "Could not download the Emscripten SDK."
fi
if [ ! -x "$CF_EMSDK_DIR/upstream/emscripten/emcc" ]; then
    "$CF_EMSDK_DIR/emsdk" install "$CF_EMSDK_VERSION" || fail "Could not install Emscripten $CF_EMSDK_VERSION."
fi
"$CF_EMSDK_DIR/emsdk" activate "$CF_EMSDK_VERSION" >/dev/null 2>&1 || fail "Could not activate Emscripten $CF_EMSDK_VERSION."
export EMSDK_QUIET=1
# shellcheck disable=SC1091
. "$CF_EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

if [ ! -f "build-web/CMakeCache.txt" ] || [ ! -f "build-web/Makefile" ]; then
    echo "Configuring web build..."
    if ! emcmake cmake -S web -B build-web -DCMAKE_BUILD_TYPE=Release; then
        rm -f build-web/CMakeCache.txt
        fail "CMake configure failed. See errors above."
    fi
fi

echo "Building codefine-engine.wasm..."
cmake --build build-web -j 4 || fail "Web build failed. See errors above."

echo
echo "Done. Output: packages/src/web-app/public/engine/"
