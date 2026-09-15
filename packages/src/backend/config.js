import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

  // External tool executables.
  colmapBin:
    process.env.COLMAP_BIN ||
    'C:\\Users\\xiong\\Documents\\gsplat-tools\\bin\\colmap.exe',
  brushBin:
    process.env.BRUSH_BIN ||
    'C:\\Users\\xiong\\Documents\\gsplat-tools\\brush\\target\\release\\brush.exe',

  // Training knobs. Fewer iterations = faster demo, lower quality.
  trainIters: Number(process.env.TRAIN_ITERS) || 7000,
  maxResolution: Number(process.env.MAX_RESOLUTION) || 1024,

  // Use the GPU for COLMAP SIFT (requires the CUDA build of COLMAP).
  colmapUseGpu: process.env.COLMAP_USE_GPU ?? '1',

  // Upload limits.
  maxFiles: 300,
  maxFileSizeMB: 30,
}
