# 3D Object Scanner & Visualizer

> Working title — rename to your team's project name.

Capture a real-world object from your phone and turn it into a viewable 3D model. The mobile front-end scans an object from multiple angles; a Python back-end reconstructs it with a photogrammetry + Gaussian Splatting pipeline; a custom renderer displays the result.

---

## Overview

This project takes a set of photographs of a physical object and produces a 3D asset that can be viewed in a custom renderer. It is built as three loosely-coupled parts so the team can work on them in parallel:

- **Front-end (scanner):** a mobile app that captures overlapping photos of an object from many angles. Early development targets small objects on a rotating stand (spinning-photo-booth style) for controlled, repeatable captures.
- **Back-end (reconstruction pipeline):** a Python service that runs the captured images through COLMAP (structure-from-motion + multi-view stereo) to recover camera poses and a point cloud, then through Gaussian Splatting, and exports a renderable 3D asset.
- **Engine (renderer/visualizer):** a custom 3D renderer that loads and displays the reconstructed asset.

The goal of this project is the **end-to-end build** — owning the capture → reconstruction → render pipeline ourselves — rather than beating commercial scanners on output fidelity. Final output is intentionally functional over polished.

## Pipeline

```
[Mobile Scanner]  ──photos──▶  [Ingest API]  ──▶  [Job Queue]  ──▶  [Reconstruction Worker]
                                                                          │
                                               COLMAP (SfM + MVS) ────────┤
                                               Gaussian Splatting ────────┤
                                               Surface / export ──────────┘
                                                                          │
                                                                          ▼
                                                          [3D asset: .ply / .obj / .glb]
                                                                          │
                                                                          ▼
                                                        [Custom 3D Renderer / Viewer]
```

> **Output representation is still being finalised.** COLMAP produces a point cloud; Gaussian Splatting produces a set of 3D Gaussians (a radiance field, exported as `.ply`); a triangle mesh (`.obj`/`.glb`) requires an additional surface-reconstruction/extraction step. The renderer's target format follows from that decision — see [Roadmap](#roadmap).

## Tech stack

| Part | Stack |
| --- | --- |
| Scanner (front-end) | Mobile app _(framework TBD)_ |
| Reconstruction | Python, COLMAP _(external — see below)_, Gaussian Splatting |
| API / orchestration | Python _(e.g. FastAPI)_ |
| Renderer (engine) | Custom 3D renderer _(target TBD — native C++/OpenGL or web)_ |

## What is _not_ in this repository

COLMAP is an **external dependency**, not vendored source. It is installed on the machine (or run via container) and invoked by the pipeline — it is **not** committed to Git, the same way a compiler or database wouldn't be. Reconstruction **outputs** (point clouds, splat `.ply` files, meshes, intermediate images) are large and are also excluded.

Recommended `.gitignore` essentials:

```gitignore
# COLMAP / native binaries & build output
colmap/
*.bin
build/

# Reconstruction inputs & outputs (large; keep in shared storage, not Git)
data/
outputs/
*.ply
*.obj
*.glb

# Python
__pycache__/
*.pyc
.venv/
```

Version-pin COLMAP declaratively (Docker tag, `requirements.txt`, or a note here) so the dependency is **reproducible without being stored**. If large artifacts ever need versioning, use Git LFS or object storage — not the main repo.

## Prerequisites

- **Python 3.10+**
- **COLMAP** installed separately — via system package manager, the official prebuilt binaries, a CUDA-enabled Docker image, or the `pycolmap` Python bindings.
- **A CUDA-capable GPU** for the dense reconstruction and Gaussian Splatting stages.
- _(Later, once the pipeline is networked)_ **Redis**, if using a task queue for background jobs.

## Setup

```bash
# 1. Clone
git clone <repo-url>
cd <repo>

# 2. Python environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 3. Install COLMAP (NOT bundled) — pick one:
#    - system package / prebuilt binary, then ensure `colmap` is on PATH
#    - Docker image (recommended for consistent versions across the team)
#    - pip install pycolmap
```

## Usage

The first milestone runs as a **single one-shot script** — no server, nothing running when idle:

```bash
# Process one folder of captured images end-to-end
python process.py ./data/my_object/
```

This runs the reconstruction pipeline once and exits. The networked flow (mobile upload → ingest API → background worker → viewer) is layered on only once the core pipeline is proven — see [Roadmap](#roadmap).

## Roadmap

- [ ] **Decide output representation** — point cloud vs. Gaussian splats vs. extracted mesh (drives the renderer's target format).
- [ ] **Decide renderer target** — native custom engine vs. web. _(Note: standard Gaussian-splat renderers need compute shaders, which WebGL lacks — a web splat renderer needs WebGPU or a WebGL2 quad-splatting approach.)_
- [ ] **M1 — Core pipeline (one-shot):** controlled captures of small objects on a rotating stand → COLMAP → reconstruction → export. Prove it end-to-end on a script.
- [ ] **M2 — Custom renderer:** load and display the reconstructed asset.
- [ ] **M3 — Mobile scanner:** capture flow with angle/coverage guidance.
- [ ] **M4 — Networked flow:** ingest API + background worker (queue) so heavy work runs on demand and idles at ~zero.
- [ ] **M5 — Robustness & larger objects, evaluation, polish.**

## Requirements addressed

- **Engine** — custom 3D renderer.
- **Visualizer / Renderer** — reconstruction pipeline + viewer.
- **Mobile** — phone-based scanner front-end.

## Team

Team Codefine GAM300-350

| Name | Role |
| Ethan Ng | Tech/Team Lead |
| Gerard | Design |
| Clement Ang | Engine Champion |
| Xiong Yang | Gaussian/Colmap |
| Gabriel | Frontend |
| Bryan Lim | Backend |



_TBD — confirm against course/IP requirements before publishing._
