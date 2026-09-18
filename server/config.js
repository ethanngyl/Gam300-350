import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Find an executable inside a locally-installed tool folder, without knowing the
 * release's exact internal layout or exe name. Searches `dir` recursively for a
 * file matching `re`, returning the first match; falls back to `fallback` if the
 * folder isn't there yet (e.g. the setup script hasn't been run).
 */
function findExe(dir, re, fallback) {
  const stack = [dir]
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
  return fallback
}

const toolsDir = path.join(__dirname, '..', 'tools')

/**
 * Central config for the reconstruction backend.
 *
 * Tool paths default to where this project's setup placed COLMAP and Brush
 * (in ../../gsplat-tools relative to the repo). Override any of these with
 * environment variables when running on another machine.
 */
export const config = {
  // HTTP port the API listens on (Vite proxies /api here in dev).
  port: Number(process.env.PORT) || 3001,

  // Where per-job working directories live (uploads, COLMAP db, splat output).
  jobsDir: process.env.JOBS_DIR || path.join(__dirname, 'jobs'),

  // External tool executables. Default to the repo-local copies that
  // tools/get-colmap.ps1 (and a matching Brush setup) install into tools/,
  // so a fresh clone works without hardcoded per-machine paths. Override with
  // COLMAP_BIN / BRUSH_BIN to point at a copy installed elsewhere.
  colmapBin:
    process.env.COLMAP_BIN ||
    path.join(toolsDir, 'colmap', 'bin', 'colmap.exe'),
  // Brush's release exe name/layout varies (e.g. brush_app.exe in a subfolder),
  // so search tools/brush for it rather than hardcoding the path.
  brushBin:
    process.env.BRUSH_BIN ||
    findExe(
      path.join(toolsDir, 'brush'),
      /brush.*\.exe$/i,
      path.join(toolsDir, 'brush', 'brush.exe'),
    ),

  // Training knobs. Fewer iterations = faster demo, lower quality.
  trainIters: Number(process.env.TRAIN_ITERS) || 30000,
  maxResolution: Number(process.env.MAX_RESOLUTION) || 1024,

  // Use the GPU for COLMAP SIFT. Defaults off, since the setup script installs
  // the no-CUDA build by default. Set COLMAP_USE_GPU=1 with a CUDA build.
  colmapUseGpu: process.env.COLMAP_USE_GPU ?? '0',

  // Upload limits.
  maxFiles: 300,
  maxFileSizeMB: 30,

  // --- YouTube frame ingest -------------------------------------------------
  // Python interpreter used to run tools/youtube_frames.py.
  pythonBin: process.env.PYTHON_BIN || 'python',
  // Path to the frame-extraction script (repo tools/ dir by default).
  ytScript:
    process.env.YT_SCRIPT ||
    path.join(__dirname, '..', 'tools', 'youtube_frames.py'),
  // Script that recenters/rescales the exported splat into the viewer's frame.
  normalizeScript:
    process.env.NORMALIZE_SCRIPT ||
    path.join(__dirname, '..', 'tools', 'normalize_ply.py'),
  // Default extraction rate (frames per second) and cap on frames pulled.
  ytFps: Number(process.env.YT_FPS) || 2,
  ytMaxFrames: Number(process.env.YT_MAX_FRAMES) || 200,
}
