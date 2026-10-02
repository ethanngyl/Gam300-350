#!/usr/bin/env bash
# ============================================================
#  CoDeFine - one-click launcher (Ubuntu / Linux counterpart of start.bat)
#  Installs deps, fetches COLMAP / Brush / cloudflared on first run, builds
#  the web app, then starts the backend + Cloudflare tunnel so teammates can
#  use the app.
#
#  Run from a terminal:  ./packages/start-linux.sh
#  Keep this terminal window open while teammates are using it.
#  Press Ctrl+C (or close the window) to stop both processes.
#
#  Tested on Ubuntu 22.04 / 24.04. COLMAP is installed from the distro repo
#  (apt), so the first run asks for your sudo password.
# ============================================================

set -u
cd "$(dirname "$0")" || exit 1
PKG_DIR="$(pwd)"
TOOLS="$(cd ../tools && pwd)"

# Make sure node / npm / cloudflared are found even when launched from a file
# manager, which can start with a minimal PATH. tools/ goes first so a
# repo-local cloudflared wins; user- and system-local bins go last.
export PATH="$TOOLS:$PATH:$HOME/.local/bin:/usr/local/bin"

# Wait for Enter only when a person is watching, so a failure message
# doesn't vanish when the window closes.
pause() {
    if [ -t 0 ]; then read -r -p "Press Enter to close..." _; fi
}

fail() {
    echo
    echo "*** $1 ***"
    pause
    exit 1
}

if [ "$(uname -s)" != "Linux" ]; then
    echo "start-linux.sh is written for Linux. On macOS run start.sh, on Windows start.bat."
fi

if ! command -v node >/dev/null 2>&1; then
    fail "Node.js not found - install it, then run this again:
         sudo apt install nodejs npm
       (Ubuntu's apt node can be old; for a current release use NodeSource:
         https://github.com/nodesource/distributions )"
fi

# Install/refresh dependencies first. node_modules is not in git, and it goes
# stale whenever someone pulls a commit that adds a package -- building
# without this fails with "failed to resolve import". It's a fast no-op when
# everything is already up to date.
echo "[1/5] Installing dependencies (npm install)..."
npm install || fail "npm install failed - check your internet connection and Node.js install."

echo
echo "[2/5] Building the web app (npm run build)..."
npm run build || fail "Build failed - fix the errors above, then run this again."

# ---- External tools ------------------------------------------------------
# COLMAP, Brush and cloudflared are standalone programs, not npm packages, so
# npm install doesn't provide them. COLMAP is installed via apt (onto the
# PATH); Brush and cloudflared are fetched once into tools/ (gitignored) if the
# backend can't already find them.
echo
echo "[3/5] Checking for external tools..."

# COLMAP / Brush: ask the backend's own config.js where it resolves each
# binary (repo tools/, sibling ../gsplat-tools, PATH, or COLMAP_BIN /
# BRUSH_BIN). Whatever already exists is skipped via get-tools-linux.sh's
# --skip-* flags, so only the missing tool(s) get installed.
NEED_TOOLS=0
SKIP_COLMAP=""
SKIP_BRUSH=""

if node -e "import('./src/backend/config.js').then(m=>import('node:fs').then(fs=>process.exit(fs.existsSync(m.config.colmapBin)?0:1)))"; then
    echo "    COLMAP found."
    SKIP_COLMAP="--skip-colmap"
else
    echo "    COLMAP not found - will install it via apt (needs sudo)."
    NEED_TOOLS=1
fi

if node -e "import('./src/backend/config.js').then(m=>import('node:fs').then(fs=>process.exit(fs.existsSync(m.config.brushBin)?0:1)))"; then
    echo "    Brush found."
    SKIP_BRUSH="--skip-brush"
else
    echo "    Brush not found - will download it - about 40 MB."
    NEED_TOOLS=1
fi

if [ "$NEED_TOOLS" = "1" ]; then
    echo "    Installing into the tools folder / via apt - one-time..."
    # SKIP_* are deliberately unquoted: empty means "no flag".
    # shellcheck disable=SC2086
    bash "$TOOLS/get-tools-linux.sh" $SKIP_COLMAP $SKIP_BRUSH ||
        fail "Could not install COLMAP / Brush. Check your internet connection, then run tools/get-tools-linux.sh by hand to see the full error."
fi

# Python packages for the YouTube frame extractor (yt-dlp, OpenCV). Not fatal:
# photo uploads still work without them. Recent Ubuntu/Debian mark the system
# Python "externally managed" and refuse system-wide pip installs, so they go
# into a virtualenv at tools/.venv, and PYTHON_BIN points the backend at it.
# yt-dlp is upgraded every run because YouTube changes regularly break older
# releases.
PY=""
for candidate in python3 python3.14 python3.13 python3.12 python3.11 python3.10; do
    if command -v "$candidate" >/dev/null 2>&1 &&
        "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))' >/dev/null 2>&1; then
        PY="$candidate"
        break
    fi
done

VENV="$TOOLS/.venv"
if [ -z "$PY" ]; then
    echo "    Python 3.10+ not found - YouTube import will not work until it is installed"
    echo "    (sudo apt install python3 python3-venv)."
else
    # Recreate the venv if it's missing or its interpreter was removed
    # (e.g. a Python upgrade left it dangling).
    if ! "$VENV/bin/python" -c '' >/dev/null 2>&1; then
        echo "    Creating Python virtualenv in tools/.venv ..."
        rm -rf "$VENV"
        if ! "$PY" -m venv "$VENV"; then
            echo "    *** Could not create the virtualenv - YouTube import may not work."
            echo "    *** On Ubuntu the venv module is a separate package: sudo apt install python3-venv"
        fi
    fi
    if [ -x "$VENV/bin/python" ]; then
        export PYTHON_BIN="$VENV/bin/python"
        echo "    Installing Python packages for the YouTube extractor..."
        if ! "$PYTHON_BIN" -m pip install --disable-pip-version-check -q -r "$TOOLS/requirements.txt" ||
            ! "$PYTHON_BIN" -m pip install --disable-pip-version-check -q --upgrade "yt-dlp[default]"; then
            echo "    *** pip install failed - YouTube import may not work. Run by hand to see why:"
            echo "    ***   tools/.venv/bin/python -m pip install -r tools/requirements.txt"
        fi
    fi
fi

# cloudflared: single-file binary from GitHub, saved as tools/cloudflared.
if command -v cloudflared >/dev/null 2>&1; then
    echo "    cloudflared found."
else
    case "$(uname -m)" in
        aarch64|arm64) CF_ARCH="arm64" ;;
        *)             CF_ARCH="amd64" ;;
    esac
    echo "    cloudflared not found - downloading into the tools folder - one-time, about 20 MB..."
    if curl -L --fail --progress-bar -o "$TOOLS/cloudflared" \
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CF_ARCH"; then
        chmod +x "$TOOLS/cloudflared"
        echo "    Saved to $TOOLS/cloudflared"
    else
        rm -f "$TOOLS/cloudflared"
        fail "Could not download cloudflared. Check your internet connection, or install it manually (see https://pkg.cloudflare.com for the apt repo)."
    fi
fi

# ---- Run ------------------------------------------------------------------
# Both processes run from this window. The backend logs straight here; the
# tunnel's chatty output goes to tunnel.log, and only its public URL is
# printed. Whatever way this script ends (Ctrl+C, window closed, one process
# dying), cleanup stops the other so nothing is left running. The backend
# kills its own COLMAP / Brush children when it receives SIGTERM.
BACKEND_PID=""
TUNNEL_PID=""
TUNNEL_LOG="$PKG_DIR/tunnel.log"

cleanup() {
    trap - EXIT INT TERM HUP
    echo
    echo "Stopping backend and tunnel..."
    [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null
    [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
    wait 2>/dev/null
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

echo
echo "[4/5] Starting backend on http://localhost:5005 ..."
(cd "$PKG_DIR/src/backend" && exec node server.js) &
BACKEND_PID=$!

echo "[5/5] Starting Cloudflare tunnel ..."
cloudflared tunnel --protocol http2 --url http://localhost:5005 >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

# cloudflared prints the public URL a few seconds after connecting.
TUNNEL_URL=""
i=0
while [ $i -lt 60 ]; do
    TUNNEL_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -n 1)"
    [ -n "$TUNNEL_URL" ] && break
    kill -0 "$TUNNEL_PID" 2>/dev/null || break
    sleep 1
    i=$((i + 1))
done

echo
echo "============================================================"
if [ -n "$TUNNEL_URL" ]; then
    echo " Share this URL with your teammates:"
    echo
    echo "     $TUNNEL_URL"
else
    echo " Could not get the tunnel URL yet. Check tunnel.log:"
    echo "     $TUNNEL_LOG"
    tail -n 15 "$TUNNEL_LOG" 2>/dev/null
fi
echo
echo " Backend logs appear below. Keep this window open while"
echo " teammates use the app; press Ctrl+C to stop."
echo "============================================================"
echo

# Stay up while both are running; if either exits, stop the other.
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$TUNNEL_PID" 2>/dev/null; do
    sleep 2
done
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "*** The backend stopped - see the errors above. ***"
else
    echo "*** The tunnel stopped - see $TUNNEL_LOG ***"
fi
cleanup
pause
exit 1
