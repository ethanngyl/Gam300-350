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

/**
 * Find an executable by searching each root directory recursively, in order,
 * for a file whose name matches `re`. Returns the first match, or `fallback`
 * if none of the roots exist / contain one. The release zips extract into a
 * subfolder whose name varies, so we search rather than hardcode a layout.
 */
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

/** Absolute path of `name` if it's on PATH (e.g. a Homebrew install), else null. */
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

// Check if the COLMAP binary is a CUDA build by running it with `-h` and looking
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
const colmapUseGpu =
  process.env.COLMAP_USE_GPU ?? (colmapHasCuda(colmapBin) ? '1' : '0')

// Passing the wrong name makes Brush exit with code 2 before training starts. 
// Ask the binary once which one it understands. Override with BRUSH_ITERS_FLAG if the probe can't run.
//   v0.3.0 release : --total-steps
//   main branch    : --total-train-iters
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

/**
 * Central config for the reconstruction backend.
 *
 * Tool paths are resolved relative to the repo so a fresh clone works after
 * running tools/get-colmap.ps1 and tools/get-brush.ps1. Override any of these
 * with environment variables to point at a copy installed elsewhere.
 */
export const config = {
  // HTTP port the API listens on (Vite proxies /api here in dev).
  port: Number(process.env.PORT) || 3001,

  // Where per-job working directories live (uploads, COLMAP db, splat output).
  jobsDir: process.env.JOBS_DIR || path.join(__dirname, 'jobs'),

  // External tool executables (see resolution above).
  colmapBin,
  brushBin,

  // Training knobs. Fewer iterations = faster demo, lower quality.
  trainIters: Number(process.env.TRAIN_ITERS) || 30000,
  maxResolution: Number(process.env.MAX_RESOLUTION) || 1024,
  // Name of Brush's iteration-count flag for the installed build (see above).
  brushItersFlag: brushItersFlagName,

  // Use the GPU for COLMAP SIFT (requires the CUDA build of COLMAP).
  colmapUseGpu,

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
