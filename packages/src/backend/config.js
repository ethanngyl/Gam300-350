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

// Resolve tool binaries. Precedence: explicit env var > repo-local tools/ (from
// the get-*.ps1 scripts) > sibling ../gsplat-tools. More specific roots are
// listed first so a release build wins over a debug build.
const colmapBin =
  process.env.COLMAP_BIN ||
  findExe(
    [
      path.join(toolsDir, 'colmap'),
      path.join(siblingToolsDir, 'bin'),
      siblingToolsDir,
    ],
    /^colmap\.exe$/i,
    path.join(toolsDir, 'colmap', 'bin', 'colmap.exe'),
  )

const brushBin =
  process.env.BRUSH_BIN ||
  findExe(
    [
      path.join(toolsDir, 'brush'),
      path.join(siblingToolsDir, 'brush', 'target', 'release'),
      siblingToolsDir,
    ],
    /^brush.*\.exe$/i,
    path.join(toolsDir, 'brush', 'brush.exe'),
  )

// GPU SIFT needs the CUDA build of COLMAP. get-colmap.ps1 installs the
// "nocuda" build by default (its folder name contains "nocuda"), which has no
// GPU support, so default GPU off for that build and on otherwise.
// Override explicitly with COLMAP_USE_GPU=0|1.
const colmapUseGpu =
  process.env.COLMAP_USE_GPU ?? (/nocuda/i.test(colmapBin) ? '0' : '1')

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

  // External tool executables (see resolution above).
  colmapBin,
  brushBin,

  // Training knobs. Fewer iterations = faster demo, lower quality.
  trainIters: Number(process.env.TRAIN_ITERS) || 30000,
  maxResolution: Number(process.env.MAX_RESOLUTION) || 1024,

  // Use the GPU for COLMAP SIFT (requires the CUDA build of COLMAP).
  colmapUseGpu,

  // Upload limits.
  maxFiles: 300,
  maxFileSizeMB: 30,
}
