# StructSquad — M1 Task Breakdown (Whole Team)

*Milestone 1 theme: **prove the loop.** Skeletal version of each system, first crude photos → `.ply` → rendered path, and the shared contracts frozen. Each person is scoped to their owned deliverable at its M1 bar — deeper work comes in later milestones (see the roadmap).*

---

## 🔒 Priority 0 — Shared contracts (everyone blocked until these are frozen — week 1)

Driven by **Ethan**, but the named people must sign off:

- [ ] **API contract** (Ethan + Gabriel + Bryan) — the three endpoints and their shapes:
  - `POST /upload` → `{ scan_id, status }` · `GET /status/{id}` → `processing|ready|failed` · `GET /result/{id}` → `.ply` location
- [ ] **Splat `.ply` field spec** (Ethan + Clement + Xiong Yang) — exact vertex properties (`x,y,z`, `scale_0..2`, `rot_0..3`, `opacity`, `f_dc_0..2`, `f_rest_0..44`); conventions written down (**scales log**, **opacity pre-sigmoid**, orientation, binary LE)
- [ ] **One shared sample `.ply`** (Xiong Yang provides) everyone develops against until the pipeline is live

---

## 👤 Ethan — API/Integration (T06) + Engine foundation (T03)

- [ ] Drive the two Priority-0 contracts to a decision
- [ ] Scaffold FastAPI backend (with Gabriel); stub all 3 endpoints, then make them real; unknown-id handled cleanly
- [ ] Top-level `engine/CMakeLists.txt`; move `ImportDependencies.cmake` → `engine/cmake/`; add `import_happly()`
- [ ] Confirm `cmake -S . -B build` generates the `.sln` and compiles clean
- [ ] Engine foundation with Clement (window/GL context/render loop/camera/input); hook up ImGui
- [ ] Wire the integration POC (photos → `.ply` → rendered); write the **Toolchain Decision Document**
- **M1 evidence:** full API cycle works; engine builds from source and shows a loaded object
- **Depends on:** everyone (integration) — front-load this, converge on sandbox from M2

---

## 👤 Xiong Yang — Reconstruction Pipeline (T01)

- [ ] Set up the GPU machine (NVIDIA/CUDA drivers) — confirm the trainer runs on it
- [ ] Run **COLMAP manually** on a sample photo set → camera poses + sparse cloud
- [ ] Run a **Gaussian trainer** (INRIA reference / gsplat / Postshot) on COLMAP output → `.ply`
- [ ] Prove the manual chain end-to-end: photos in → valid `.ply` out
- [ ] Script the two steps (COLMAP → trainer) so it runs as one job
- [ ] Report metrics: recovered-camera count, Gaussian count, runtime
- [ ] Produce the **shared sample `.ply`** for the engine team; co-sign the `.ply` field spec
- **M1 evidence:** a real turntable set of a small object processed to a valid `.ply`, metrics reported
- **Depends on:** GPU hardware access; `.ply` field spec

---

## 👤 Gabriel — Upload, Ingest & Storage (T04)

- [ ] Backend web app setup (FastAPI, shared with Ethan)
- [ ] Real `POST /upload`: receive multipart photos, save to a **per-scan folder** (`scans/<id>/photos/`)
- [ ] Create a scan record + status field (`processing / ready / failed`)
- [ ] On upload, **trigger the pipeline** (hand off to Xiong Yang's script)
- [ ] `GET /status/{id}` reads real job state; result location returned when ready
- **M1 evidence:** a capture set uploaded from the client lands in per-scan storage; record created; status transitions observable
- **Depends on:** API contract (Ethan); pipeline script (Xiong Yang)

---

## 👤 Bryan — Guided Capture Module (T05)

- [ ] In-browser **camera capture** working in the React app (camera API / `getUserMedia`)
- [ ] Capture a **batch of photos**, hold in state, show thumbnails
- [ ] Basic capture UI: capture button, running count, review / retake
- [ ] Hand the photo batch to the upload flow (integrate with `POST /upload`)
- **M1 evidence:** web client captures a photo batch and sends it to the backend
- **Depends on:** React app (done); API contract (Ethan)
- **Note:** coverage/overlap validation is a *later* milestone — M1 is just capture + batch

---

## 👤 Clement — Gaussian Splat Renderer (T02)

- [ ] Get the engine building (with Ethan's `CMakeLists.txt`)
- [ ] Load a **sample splat `.ply`** via happly
- [ ] Parse Gaussians into a struct (apply **exp** to scales, **sigmoid** to opacity at load)
- [ ] Draw each Gaussian as a billboard/quad
- [ ] **CPU depth-sort** back-to-front + alpha-blend → first coherent image
- [ ] Orbit camera to view it
- **M1 evidence:** loads a sample `.ply` and renders it in the engine with an orbit camera
- **Depends on:** engine foundation (with Ethan); `.ply` field spec
- **Note:** SH (view-dependent) colour and GPU radix sort are *later* — flat colour + CPU sort is the M1 bar

---

## 👤 Jm — UI Interface (web UI at M1; sandbox UI from M3)

- [ ] Design the capture flow across surfaces (desktop/mobile responsive)
- [ ] Design + implement the **status states** UI: uploading → processing → ready / failed
- [ ] Turn wireframes into UI components (with Gerard)
- **M1 evidence:** the capture-and-status UI is implemented and navigable
- **Depends on:** React app scaffold; status model (Ethan)
- **Note:** the engine **sandbox UI** is your M3+ work — at M1, focus the web app

---

## 👤 Gerard — Frontend / Web App Design (HTML/CSS)

- [ ] Web app layout + structure (HTML/CSS in React) — **get the UI done first**
- [ ] Implement the core screens with Jm (capture, status, result)
- [ ] Styling + responsive behaviour; support Bryan's camera UI
- **M1 evidence:** web app UI built, styled, and navigable
- **Depends on:** React app scaffold

---

## ✅ M1 fixed-required items (graded — owner assigned)

| Item | Owner |
|---|---|
| GitHub repository + workflow | Ethan |
| Jira project + epics | Ethan (team lead) |
| Architecture v0.1 | Ethan (the brief) |
| Automated build | Clement/Ethan (engine) · Gabriel (backend) |
| Automated checks / tests | Bryan/Gerard (`npm run lint`) · backend basic test |
| Reproducible dev setup (README) | Ethan compiles; each track documents its own restore cmd |
| Working technical POC | Ethan (integration) + all |
| Basic error handling | each owner, in their component |
| Working product demonstration | whole team |
| Project documentation | whole team |
| Individual contribution evidence | each person (commits + Jira) |
| Toolchain Decision Document | Ethan |

---

## 🔗 Critical path (what unblocks what)

1. **Contracts (P0)** unblock everyone → week 1.
2. **Xiong Yang's `.ply`** unblocks Clement's real render and Ethan's integration → get a sample out early; use a downloaded sample in the meantime.
3. **Ethan's API** unblocks Gabriel (backend behind it) and Bryan/Jm/Gerard (frontend against it) → stub it first so they're not waiting.
4. **Engine foundation (Ethan+Clement)** unblocks all engine work → build must compile before rendering means anything.

**Decoupling trick:** engine develops against a downloaded sample `.ply`, frontend against the stubbed API — nobody waits on the backend to start.

*One object, all the way through the loop, however crude — that's the M1 win. Depth comes later.*