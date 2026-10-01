# ============================================================
#  CoDeFine backend + web app (photos -> COLMAP -> Brush -> .ply)
#
#  Build:  docker compose build
#  Run:    docker compose up            (http://localhost:5005)
#
#  The C++ engine (engine/) is a Windows desktop app and is not
#  part of this image.
# ============================================================

# ---- Stage 1: build the React app and install server deps ----------
FROM node:22-bookworm-slim AS web
WORKDIR /app/packages
COPY packages/package.json packages/package-lock.json ./
RUN npm ci
COPY packages/ ./
RUN npm run build && npm prune --omit=dev

# ---- Stage 2: runtime (COLMAP's official CUDA image) ---------------
FROM colmap/colmap:latest

ARG BRUSH_VERSION=v0.3.0
ENV DEBIAN_FRONTEND=noninteractive

# Python (YouTube extractor + normalize_ply), ffmpeg for yt-dlp, OpenCV's
# system libs, and Vulkan loader + Mesa drivers for Brush (wgpu).
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-venv ffmpeg libgl1 libglib2.0-0 \
        libvulkan1 mesa-vulkan-drivers curl xz-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node runtime, taken from the build stage's image.
COPY --from=web /usr/local/bin/node /usr/local/bin/node

# Brush (Linux x86_64 release).
RUN mkdir -p /opt/brush \
    && curl -L --fail -o /tmp/brush.tar.xz \
       "https://github.com/ArthurBrussee/brush/releases/download/${BRUSH_VERSION}/brush-app-x86_64-unknown-linux-gnu.tar.xz" \
    && tar -xJf /tmp/brush.tar.xz -C /opt/brush \
    && rm /tmp/brush.tar.xz \
    && ln -s "$(find /opt/brush -type f -name 'brush*' ! -name '*.*' | head -n1)" /usr/local/bin/brush_app \
    && chmod +x /usr/local/bin/brush_app

# Python deps in a venv (Ubuntu's system pip is externally managed).
COPY tools/requirements.txt /app/tools/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /app/tools/requirements.txt

# App: same layout as the repo so config.js resolves tools/ correctly.
COPY tools/youtube_frames.py tools/normalize_ply.py /app/tools/
COPY --from=web /app/packages /app/packages

ENV PORT=5005 \
    JOBS_DIR=/data/jobs \
    COLMAP_BIN=/usr/local/bin/colmap \
    BRUSH_BIN=/usr/local/bin/brush_app \
    PYTHON_BIN=/opt/venv/bin/python \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics

VOLUME /data/jobs
EXPOSE 5005
WORKDIR /app/packages/src/backend
CMD ["node", "server.js"]
