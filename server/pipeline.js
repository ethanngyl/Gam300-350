import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

/**
 * In-memory job store. Single-user demo, so no database — jobs live for the
 * lifetime of the server process. Each job:
 *   { id, status, phase, progress, log[], error, createdAt, resultPath }
 * status: queued | running | done | error
 * phase:  upload | colmap-features | colmap-matching | colmap-mapping | training | done
 */
export const jobs = new Map()

function makeJob(id) {
  const job = {
    id,
    status: 'queued',
    phase: 'upload',
    progress: 0, // 0..1, best-effort
    log: [],
    error: null,
    createdAt: Date.now(),
    resultPath: null,
  }
  jobs.set(id, job)
  return job
}

function appendLog(job, line) {
  const trimmed = String(line).replace(/\s+$/, '')
  if (!trimmed) return
  job.log.push(trimmed)
  // Keep the log bounded so long runs don't grow unbounded in memory.
  if (job.log.length > 400) job.log.splice(0, job.log.length - 400)
}

/**
 * Spawn a child process and resolve on exit 0, reject otherwise.
 * Streams stdout/stderr into the job log, and lets an optional onData hook
 * parse lines for progress.
 */
function run(job, bin, args, { cwd, onData } = {}) {
  return new Promise((resolve, reject) => {
    appendLog(job, `\n$ ${path.basename(bin)} ${args.join(' ')}`)
    const child = spawn(bin, args, { cwd, windowsHide: true })

    const handle = (buf) => {
      const text = buf.toString()
      for (const line of text.split(/\r?\n/)) {
        appendLog(job, line)
        if (onData) onData(line)
      }
    }
    child.stdout.on('data', handle)
    child.stderr.on('data', handle)

    child.on('error', (err) =>
      reject(new Error(`Failed to start ${bin}: ${err.message}`)),
    )
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${path.basename(bin)} exited with code ${code}`))
    })
  })
}

/**
 * Extract frames from a YouTube URL into a job's images/ directory by running
 * tools/youtube_frames.py. Resolves with the number of frames written.
 * Reuses the same child-process logging as the rest of the pipeline.
 */
export async function extractYoutubeFrames(job, url, { fps, maxFrames } = {}) {
  const jobDir = path.join(config.jobsDir, job.id)
  const imagesDir = path.join(jobDir, 'images')
  await fsp.mkdir(imagesDir, { recursive: true })

  job.status = 'running'
  job.phase = 'extract'
  job.progress = 0.02

  await run(job, config.pythonBin, [
    config.ytScript,
    url,
    '--output', imagesDir,
    '--fps', String(fps ?? config.ytFps),
    '--max-frames', String(maxFrames ?? config.ytMaxFrames),
  ])

  const frames = (await fsp.readdir(imagesDir)).filter((f) =>
    /\.(jpe?g|png)$/i.test(f),
  )
  return frames.length
}

/**
 * Create a reconstruction job seeded from a YouTube URL: extract frames, then
 * run the normal reconstruction pipeline. Intended to be called in the
 * background (not awaited) after responding to the client.
 */
export async function runYoutubePipeline(job, url, opts = {}) {
  try {
    const count = await extractYoutubeFrames(job, url, opts)
    job.imageCount = count
    if (count < 8) {
      throw new Error(
        `Extracted only ${count} frame(s). Need at least 8 for a reconstruction — ` +
          'try a longer clip or a higher --fps.',
      )
    }
  } catch (err) {
    job.status = 'error'
    job.error = err.message
    appendLog(job, `\nERROR: ${err.message}`)
    return
  }
  await runPipeline(job)
}

/**
 * Full reconstruction pipeline for one job directory.
 * Layout produced (INRIA/COLMAP convention that Brush reads):
 *   <jobDir>/images/         uploaded photos
 *   <jobDir>/database.db     COLMAP feature database
 *   <jobDir>/sparse/0/       COLMAP sparse model (poses + points)
 *   <jobsDir>/<id>_out/      Brush splat .ply exports
 */
export async function runPipeline(job) {
  const jobDir = path.join(config.jobsDir, job.id)
  const imagesDir = path.join(jobDir, 'images')
  const dbPath = path.join(jobDir, 'database.db')
  const sparseDir = path.join(jobDir, 'sparse')

  try {
    job.status = 'running'

    // --- COLMAP: feature extraction ---
    job.phase = 'colmap-features'
    job.progress = 0.05
    await run(job, config.colmapBin, [
      'feature_extractor',
      '--database_path', dbPath,
      '--image_path', imagesDir,
      '--ImageReader.single_camera', '1',
      '--FeatureExtraction.use_gpu', config.colmapUseGpu,
    ])

    // --- COLMAP: exhaustive matching ---
    job.phase = 'colmap-matching'
    job.progress = 0.2
    await run(job, config.colmapBin, [
      'exhaustive_matcher',
      '--database_path', dbPath,
      '--FeatureMatching.use_gpu', config.colmapUseGpu,
    ])

    // --- COLMAP: sparse mapping (recovers camera poses) ---
    job.phase = 'colmap-mapping'
    job.progress = 0.35
    await fsp.mkdir(sparseDir, { recursive: true })
    await run(job, config.colmapBin, [
      'mapper',
      '--database_path', dbPath,
      '--image_path', imagesDir,
      '--output_path', sparseDir,
    ])

    // Mapper writes sparse/0 (sometimes 1,2.. if it splits). Require at least one.
    const models = fs.existsSync(sparseDir)
      ? (await fsp.readdir(sparseDir)).filter((d) => /^\d+$/.test(d))
      : []
    if (models.length === 0) {
      throw new Error(
        'COLMAP could not reconstruct a model from these photos. ' +
          'Try more photos with more overlap and texture.',
      )
    }

    // --- Brush: train the gaussian splat ---
    job.phase = 'training'
    job.progress = 0.45
    const outDirName = `${job.id}_out`
    // Best-effort progress parse from Brush's step output.
    const stepRe = /(\d[\d,]*)\s*\/\s*(\d[\d,]*)/
    await run(
      job,
      config.brushBin,
      [
        job.id, // dataset dir name, relative to cwd (jobsDir)
        '--max-resolution', String(config.maxResolution),
        '--total-steps', String(config.trainIters),
        '--export-path', `./${outDirName}/`,
        '--export-name', 'splat_{iter}.ply',
        '--export-every', String(config.trainIters),
      ],
      {
        cwd: config.jobsDir,
        onData: (line) => {
          const m = line.match(stepRe)
          if (m) {
            const cur = Number(m[1].replace(/,/g, ''))
            const total = Number(m[2].replace(/,/g, ''))
            if (total > 0 && cur <= total) {
              // Map training [0..1] onto the 0.45..0.98 band.
              job.progress = 0.45 + 0.53 * (cur / total)
            }
          }
        },
      },
    )

    // --- Locate the exported .ply (highest iteration) ---
    const outDir = path.join(config.jobsDir, outDirName)
    const plys = fs.existsSync(outDir)
      ? (await fsp.readdir(outDir)).filter((f) => f.toLowerCase().endsWith('.ply'))
      : []
    if (plys.length === 0) {
      throw new Error('Training finished but no .ply was exported.')
    }
    plys.sort() // splat_00500, splat_07000 ... lexical works with zero-padding
    const rawPly = path.join(outDir, plys[plys.length - 1])

    // --- Normalize into the viewer's frame ---
    // COLMAP reconstructs in an arbitrary world frame (object far from origin,
    // arbitrary scale), which loads but renders off-screen in the viewer. Recenter
    // + rescale into a result.ply that matches the shared sample's frame.
    job.phase = 'normalize'
    job.progress = 0.99
    const finalPly = path.join(outDir, 'result.ply')
    try {
      await run(job, config.pythonBin, [config.normalizeScript, rawPly, finalPly])
      job.resultPath = finalPly
    } catch (err) {
      // Best-effort: if normalization fails, still hand back the raw export.
      appendLog(job, `\nNormalization failed (${err.message}); serving raw export.`)
      job.resultPath = rawPly
    }

    job.phase = 'done'
    job.progress = 1
    job.status = 'done'
    appendLog(job, `\nDone. Result: ${job.resultPath}`)
  } catch (err) {
    job.status = 'error'
    job.error = err.message
    appendLog(job, `\nERROR: ${err.message}`)
  }
}

export { makeJob }
