#!/usr/bin/env bash
# ============================================================
#  Codefine Engine - C++ lint (clang-tidy)
#
#  Runs clang-tidy, with the checks in engine/.clang-tidy, on the
#  renderer code (src/gfx, src/splat). That is the part shared by
#  the desktop editor and the WebAssembly build, and it doesn't
#  need Qt, so it can be checked on any machine. Exits non-zero
#  on any finding; CI runs it on every push.
#
#  Needs git and clang-tidy (pip install clang-tidy==22.1.8, or
#  set CLANG_TIDY to its path). Header-only dependencies come from
#  build/_deps when engine/run.bat has been run; otherwise the
#  pinned versions from cmake/ImportDependencies.cmake are fetched
#  into build-lint/_deps (gitignored).
# ============================================================

set -euo pipefail
cd "$(dirname "$0")"

CLANG_TIDY="${CLANG_TIDY:-clang-tidy}"

# Shallow-fetch one dependency at a pinned tag / commit, once.
fetch() {
    local name="$1" repo="$2" ref="$3" dir="build-lint/_deps/$1-src"
    if [ ! -d "$dir/.git" ]; then
        mkdir -p "$dir"
        git -C "$dir" init -q
        git -C "$dir" remote add origin "$repo"
        git -C "$dir" fetch -q --depth 1 origin "$ref"
        git -C "$dir" checkout -q FETCH_HEAD
    fi
}

DEPS=build/_deps
if [ ! -f "$DEPS/glm-src/glm/glm.hpp" ] || [ ! -f "$DEPS/glew-src/include/GL/glew.h" ] || [ ! -f "$DEPS/happly-src/happly.h" ]; then
    DEPS=build-lint/_deps
    # Keep in step with cmake/ImportDependencies.cmake.
    fetch glm https://github.com/g-truc/glm.git 1.0.1
    fetch glew https://github.com/Perlmint/glew-cmake.git d06782b910213d675925e6e51a69ad0fd1fe1f23
    fetch happly https://github.com/nmwsharp/happly.git 983e8edf73c515511720f61d3142cb842bc144d9
fi

FILES=$(find src/gfx src/splat -name '*.cpp' | sort)

"$CLANG_TIDY" --version | head -n 2
echo "Checking:" $FILES

# shellcheck disable=SC2086  # FILES is a list of paths without spaces
"$CLANG_TIDY" --quiet $FILES -- \
    -std=c++20 -xc++ \
    -Isrc \
    -isystem "$DEPS/glm-src" \
    -isystem "$DEPS/glew-src/include" \
    -isystem "$DEPS/happly-src" \
    -DGLEW_STATIC -DGLEW_NO_GLU

echo "clang-tidy: no findings."
