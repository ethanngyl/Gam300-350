/*!************************************************************************
\file config.js
\author1 Xiong Yang
\author2 Gabriel Sebastian Putra
\par DP email1: xiong.yang@digipen.edu
\par DP email2: gabrielsebastian.p@digipen.edu 
\par Course: csd3401f26
\par Software Engineering Project 5
\date 30-09-2026
\brief
Central configuration for the reconstruction backend. It works out where the
COLMAP and Brush executables are, probes them once at startup for GPU support
and the right command-line flag, and exports a single config object that
every other backend file reads (ports, folders, tool paths, training knobs,
upload limits, python scripts). Any value can be overridden with an
environment variable.
- findExe(roots, re, fallback)
Searches each root folder recursively, in order, for a file whose name
matches re. Returns the first match, or fallback if none is found. The
release zips extract into a subfolder whose name varies, so it searches
rather than hardcoding a layout.
- findOnPath(name)
Returns the absolute path of name if it is on the system PATH (e.g. a
Homebrew install), else null.
- colmapHasCuda(exe)
Runs COLMAP with -h and checks the output for "with CUDA". Decides whether
COLMAP should use the GPU when COLMAP_USE_GPU isn't set.
- brushItersFlag(exe)
Runs Brush with --help to find out which iteration-count flag this build
understands (--total-steps or --total-train-iters).
- config
The exported settings object used by server.js, pipeline.js, scan.js and
status.js.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Repo root (this file lives at packages/src/backend/).
const repoRoot = path.join(__dirname, '..', '..', '..')
// Repo-local tool folder that tools/get-colmap.ps1 and tools/get-brush.ps1
// install into (gitignored, so each developer runs the scripts once).
const toolsDir = path.join(repoRoot, 'tools')
// Legacy/sibling location for developers who built the tools themselves.
const siblingToolsDir = path.join(repoRoot, '..', 'gsplat-tools')

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Find an executable by searching each root directory recursively, in
    order, for a file whose name matches `re`. The release zips extract
    into a subfolder whose name varies, so we search rather than hardcode
    a layout.
  \param roots
    string[]
    The folders to search, most specific first.
  \param re
    RegExp
    The pattern the executable's file name must match.
  \param fallback
    string
    The path to return if nothing is found.
  \return
    The first matching path, else fallback if none of the roots exist or
    contain one.
*/
/************************************************************************/
function findExe(roots, re, fallback) {
  for (const root of roots) {
    const stack = [root]
    while (stack.length) {
      const current = stack.pop()
      let entries
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        const full = path.join(current, e.name)
        if (e.isDirectory()) stack.push(full)
        else if (re.test(e.name)) return full
      }
    }
  }
  return fallback
}

/************************************************************************/
/*!
  \brief
    Looks for an executable in every folder on the system PATH (e.g. a
    Homebrew install).
  \param name
    string
    The executable's file name.
  \return
    The absolute path of name if it's on PATH, else null.
*/
/************************************************************************/
function findOnPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    const full = path.join(dir, name)
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full
  }
  return null
}

// Windows builds ship .exe files; the macOS / Linux builds have no extension
// (COLMAP.app/Contents/MacOS/colmap, brush-app-*/brush_app).
const isWindows = process.platform === 'win32'
const exeSuffix = isWindows ? '.exe' : ''

// Resolve tool binaries. Precedence: explicit env var > repo-local tools/ (from
// get-tools.ps1 / get-tools.sh) > sibling ../gsplat-tools > PATH. More specific
// roots are listed first so a release build wins over a debug build.
const colmapBin =
  process.env.COLMAP_BIN ||
  findExe(
    [
      path.join(toolsDir, 'colmap'),
      path.join(siblingToolsDir, 'bin'),
      siblingToolsDir,
    ],
    isWindows ? /^colmap\.exe$/i : /^colmap$/,
    findOnPath(`colmap${exeSuffix}`) ||
      path.join(toolsDir, 'colmap', 'bin', `colmap${exeSuffix}`),
  )

const brushBin =
  process.env.BRUSH_BIN ||
  findExe(
    [
      path.join(toolsDir, 'brush'),
      path.join(siblingToolsDir, 'brush', 'target', 'release'),
      siblingToolsDir,
    ],
    isWindows ? /^brush.*\.exe$/i : /^brush[\w-]*$/i,
    findOnPath(`brush_app${exeSuffix}`) ||
      path.join(toolsDir, 'brush', `brush${exeSuffix}`),
  )

/************************************************************************/
/*!
  \brief
    Check if the COLMAP binary is a CUDA build by running it with `-h` and
    looking for "with CUDA" in its output.
  \param exe
    string
    The path to the COLMAP executable.
  \return
    bool, true if COLMAP was built with CUDA, false if not or if it
    couldn't be run.
*/
/************************************************************************/
function colmapHasCuda(exe) {
  try {
    const r = spawnSync(exe, ['-h'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    })
    return /with CUDA/i.test(`${r.stdout ?? ''}${r.stderr ?? ''}`)
  } catch {
    return false
  }
}
// A CUDA build still says "with CUDA" on an AMD / Intel machine, and use_gpu=1
// then fails at feature extraction, so also require an NVIDIA driver.
// nvidia-smi ships with the driver on Windows and Linux; if it's missing or
// lists no GPUs, COLMAP runs on the CPU (the CUDA build handles that fine).
function hasNvidiaGpu() {
  try {
    const r = spawnSync('nvidia-smi', ['-L'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    })
    return r.status === 0 && /^GPU \d+:/m.test(r.stdout ?? '')
  } catch {
    return false
  }
}
const colmapUseGpu =
  process.env.COLMAP_USE_GPU ??
  (colmapHasCuda(colmapBin) && hasNvidiaGpu() ? '1' : '0')

/************************************************************************/
/*!
  \brief
    Passing the wrong name makes Brush exit with code 2 before training
    starts. Ask the binary once which one it understands. Override with
    BRUSH_ITERS_FLAG if the probe can't run.
      v0.3.0 release : --total-steps
      main branch    : --total-train-iters
  \param exe
    string
    The path to the Brush executable.
  \return
    '--total-steps' if Brush's help lists it, else '--total-train-iters'.
*/
/************************************************************************/
function brushItersFlag(exe) {
  try {
    const r = spawnSync(exe, ['--help'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    })
    const help = `${r.stdout ?? ''}${r.stderr ?? ''}`
    if (/--total-steps\b/.test(help)) return '--total-steps'
  } catch {
    // Fall through to the source-build name.
  }
  return '--total-train-iters'
}
const brushItersFlagName = process.env.BRUSH_ITERS_FLAG || brushItersFlag(brushBin)

// COLMAP 4.x renamed the SiftExtraction/SiftMatching option namespaces to
// FeatureExtraction/FeatureMatching. Passing the wrong one makes COLMAP exit
// with "unrecognised option" before anything runs. Ask feature_extractor which
// it understands (both namespaces were renamed together, so the extractor's
// help settles the matcher too). Override with COLMAP_LEGACY_FLAGS=1 to force
// the old Sift* names, or =0 to force the new Feature* names, if the probe
// can't run (e.g. COLMAP not installed yet).
//   3.x : --SiftExtraction.use_gpu    / --SiftMatching.use_gpu
//   4.x : --FeatureExtraction.use_gpu / --FeatureMatching.use_gpu
function colmapUsesFeatureNamespace(exe) {
  try {
    const r = spawnSync(exe, ['feature_extractor', '--help'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    })
    // spawnSync reports a missing/unrunnable binary via r.error (it does not
    // throw), so guard on that before reading the help text.
    if (r.error) return true // can't run COLMAP yet -> default to newer names
    const help = `${r.stdout ?? ''}${r.stderr ?? ''}`
    if (/--FeatureExtraction\.use_gpu/.test(help)) return true // 4.x
    if (/--SiftExtraction\.use_gpu/.test(help)) return false // 3.x
    return true // help didn't mention either -> default to newer names
  } catch {
    return true // default to the newer names the pipeline was written for
  }
}
const colmapLegacyFlags = process.env.COLMAP_LEGACY_FLAGS
const colmapUseFeatureNs =
  colmapLegacyFlags === '1' ? false
  : colmapLegacyFlags === '0' ? true
  : colmapUsesFeatureNamespace(colmapBin)
const colmapExtractionNs = colmapUseFeatureNs ? 'FeatureExtraction' : 'SiftExtraction'
const colmapMatchingNs = colmapUseFeatureNs ? 'FeatureMatching' : 'SiftMatching'

/**
 * Central config for the reconstruction backend.
 *
 * Tool paths are resolved relative to the repo so a fresh clone works after
 * running tools/get-colmap.ps1 and tools/get-brush.ps1. Override any of these
 * with environment variables to point at a copy installed elsewhere.
 */
export const config = {
  // HTTP port the API listens on (Vite proxies /api here in dev).
  port: Number(process.env.PORT) || 5005,

  // Where per-job working directories live (uploads, COLMAP db, splat output).
  jobsDir: process.env.JOBS_DIR || path.join(__dirname, 'jobs'),

  // Every finished job's result.ply is also copied here (see runPipeline), so
  // it shows up in the native engine's samples browser (engine/src/main.cpp)
  // without a manual copy step.
  engineSamplesDir:
    process.env.ENGINE_SAMPLES_DIR || path.join(repoRoot, 'engine', 'assets', 'samples'),

  // External tool executables (see resolution above).
  colmapBin,
  brushBin,

  // Training knobs. Fewer iterations = faster demo, lower quality.
  trainIters: Number(process.env.TRAIN_ITERS) || 1000,
  maxResolution: Number(process.env.MAX_RESOLUTION) || 1024,
  // Name of Brush's iteration-count flag for the installed build (see above).
  brushItersFlag: brushItersFlagName,

  // Use the GPU for COLMAP SIFT (requires the CUDA build of COLMAP).
  colmapUseGpu,
  // GPU-toggle flags for the installed COLMAP (Sift* on 3.x, Feature* on 4.x).
  colmapExtractionUseGpuFlag: `--${colmapExtractionNs}.use_gpu`,
  colmapMatchingUseGpuFlag: `--${colmapMatchingNs}.use_gpu`,

  // Upload limits.
  maxFiles: 300,
  maxFileSizeMB: 30,

  // --- Python post-processing / ingest scripts (repo tools/ dir) -------------
  // Interpreter used to run them. Needs `pip install -r tools/requirements.txt`
  // for the YouTube extractor (yt-dlp, opencv); normalize needs only stdlib.
  // macOS has no `python` command, only `python3` (start.sh sets PYTHON_BIN
  // to its virtualenv's interpreter).
  pythonBin: process.env.PYTHON_BIN || (isWindows ? 'python' : 'python3'),
  // Extracts evenly spaced frames from a YouTube video into a job's images/.
  ytScript: process.env.YT_SCRIPT || path.join(toolsDir, 'youtube_frames.py'),
  // Default extraction rate (frames per second) and cap on frames pulled.
  ytFps: Number(process.env.YT_FPS) || 2,
  ytMaxFrames: Number(process.env.YT_MAX_FRAMES) || 200,
  // Upper bound on the requested extraction rate.
  ytMaxFps: 30,
  // Videos longer than this are refused before anything is downloaded.
  ytMaxDurationSec: Number(process.env.YT_MAX_DURATION) || 20 * 60,
  // Kill the download + extraction if it runs longer than this.
  ytTimeoutMin: Number(process.env.YT_TIMEOUT_MIN) || 30,
  // Recenters/rescales the trained splat into the viewer's frame.
  normalizeScript:
    process.env.NORMALIZE_SCRIPT || path.join(toolsDir, 'normalize_ply.py'),
}
