# Ethan — M1 Task List

*Personal tracker. Scope: my two owned deliverables (T06 API gateway, T03 engine foundation), the shared contracts I drive, and my share of the M1 fixed-required items. Teammates' tasks are not listed here — see the M1 contract sheet for those.*

---

## Priority 0 — Contracts to lock (do first; the whole team is blocked on these)

These aren't "mine" alone, but I own driving them to a decision in week 1 because every other track builds against them.

- [ ] **Freeze the API contract** — write down the three endpoints and their shapes so frontend + backend build in parallel:
  - [ ] `POST /upload` — multipart photos in → returns `{ scan_id, status }`
  - [ ] `GET /status/{scan_id}` — returns `processing | ready | failed` (+ reason on failed)
  - [ ] `GET /result/{scan_id}` — returns the `.ply` location (URL/path)
  - [ ] Define the scan-status model (the states + transitions)
- [ ] **Agree the splat `.ply` field spec** with Clement (engine) + Xiong Yang (pipeline):
  - [ ] Exact vertex properties: `x,y,z`, `scale_0..2`, `rot_0..3`, `opacity`, `f_dc_0..2`, `f_rest_0..44`
  - [ ] Conventions written down: **scales are log** (exp at load), **opacity is pre-sigmoid** (sigmoid at load), coordinate/orientation, binary little-endian
  - [ ] One shared **sample `.ply`** everyone develops against until the pipeline produces real ones

---

## T06 — API / Orchestration Gateway (my deliverable)

- [ ] Scaffold the backend web app (FastAPI) — shared setup with Gabriel
- [ ] Stub all three endpoints returning fake data first, so frontend can integrate immediately
- [ ] Replace stubs with real behaviour: upload saves photos + creates a scan record + returns a real id
- [ ] Status endpoint reads real job state; `result` returns the real `.ply` location
- [ ] Handle one negative case cleanly (unknown `scan_id` → 404, not a crash)
- [ ] **M1 evidence:** full cycle over the real API — upload → job id → poll status → get result URL

---

## T03 — Engine foundation (my deliverable, paired with Clement)

*At M1 this is Layer 0 + first render, not the full sandbox.*

- [ ] Create the **top-level `engine/CMakeLists.txt`** (the missing piece):
  - [ ] Set C++ standard, project name, engine executable from `src/`
  - [ ] `list(APPEND CMAKE_MODULE_PATH .../cmake)` + `include(ImportDependencies)` + `importDependencies()`
  - [ ] Link GLFW / GLEW / GLM / ImGui / **happly**
- [ ] Move `ImportDependencies.cmake` into `engine/cmake/`
- [ ] Add the `import_happly()` macro + call it in `importDependencies()`
- [ ] Confirm `cmake -S . -B build` generates the `.sln` and `cmake --build build` compiles clean
- [ ] Engine foundation (with Clement): window + GL context (GLFW), GLEW init, render loop, orbit camera, input
- [ ] Hook up ImGui (needed for sandbox UI later)
- [ ] Load a **sample splat `.ply`** via happly and get *something* on screen (flat blobs fine)
- [ ] **M1 evidence:** engine builds from source on a teammate's machine and shows a loaded object

---

## Repo & infrastructure (I coordinate / own setup)

- [ ] Monorepo structure settled: `packages/` (web) · `backend/` · `engine/`
  - [ ] Consider renaming `packages/` → `web/` before it's widely shared (cosmetic, cheap now)
- [ ] Root `.gitignore` covers all three toolchains (node_modules, .venv/__pycache__, build/_deps, scan data, OS/editor junk)
- [ ] Verify `node_modules/` is NOT tracked (`git status` clean)
- [ ] **README with reproducible setup** — clone-and-run for all three folders:
  - [ ] web: `npm install` → `npm run dev`
  - [ ] backend: `pip install -r requirements.txt` (in a venv)
  - [ ] engine: `cmake -S . -B build` → `cmake --build build`
- [ ] Have a teammate clone fresh and follow the README to prove it works from zero

---

## My share of the M1 fixed-required items

- [ ] **Architecture v0.1** — mostly done (the project brief); confirm it's in the repo as the agreed version
- [ ] **Toolchain Decision Document** — write it, with the "why" for each choice:
  - [ ] Web: React + Vite (stateful capture/status UI, parallel component work), ESLint
  - [ ] Backend: Python + FastAPI + COLMAP + Gaussian trainer (same lang receives upload & drives tools)
  - [ ] Engine: C++ / OpenGL / CMake + FetchContent (custom renderer = the deliverable)
  - [ ] Storage: cloud target, local-first
- [ ] **Working technical POC** — the integration wiring is mine: prove one crude path photos → `.ply` → rendered
- [ ] **Working product demonstration** — coordinate the end-to-end demo run
- [ ] **Automated checks** — confirm `npm run lint` is wired into CI (satisfies the check requirement for the web side)

---

## Sequencing (so I don't block myself)

1. **Week 1:** lock the two contracts (P0) — unblocks everyone, including future-me.
2. **Then in parallel:** stub the API (frontend can start) *and* stand up the engine build + foundation with Clement.
3. **Mid-M1:** real API behaviour + first sample `.ply` rendering.
4. **Late M1:** wire the integration into the POC; write the Toolchain doc; prove the README from zero.

## Watch (owned by others, but I depend on them)

- Xiong Yang — pipeline producing a real `.ply` (my integration + Clement's render need it)
- Gabriel — upload/storage (pairs with my API)
- Bryan/Gerard — capture + web UI (integrates against my API)

*Front-load the API/integration now; converge hard onto the sandbox (T03 Layer 2–3) from M2 onward.*cd src
