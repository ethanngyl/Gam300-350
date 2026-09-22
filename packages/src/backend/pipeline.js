import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

/**
 * In-memory job store. Single-user demo, so no database — jobs live for the
 * lifetime of the server process. Each job:
 *   { id, status, phase, progress, log[], error, createdAt, resultPath }
 * status: queued | running | done | error | cancelled
 * phase:  upload | extract | colmap-features | colmap-matching | colmap-mapping
 *         | training | normalize | done
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
    cancelled: false, // set by cancelJob(); makes the pipeline stop between stages
    child: null, // the tool process currently running for this job, if any
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
 * Every tool process currently running (COLMAP, Brush, python). Tracked so the
 * server can terminate them on shutdown -- on Windows a child is NOT killed
 * when its parent Node process dies, so without this a restart leaves Brush
 * training as an orphan, hogging the GPU for a job nobody can poll anymore.
 */
const liveChildren = new Set()

/**
 * Terminate every live tool process (and their own children, e.g. the
 * yt-dlp/ffmpeg that youtube_frames.py spawns). Synchronous on purpose so it
 * is safe to call from process 'exit' handlers, where async work never runs.
 */
export function killChildren() {
  for (const child of liveChildren) killChild(child)
}

/** Terminate one tool process and everything it spawned. Synchronous. */
function killChild(child) {
  liveChildren.delete(child)
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform === 'win32') {
      // child.kill() only hits the direct child; taskkill /T takes the tree.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 5000,
      })
    } else {
      // Children are spawned detached (own process group) so killing the
      // negative pid takes the whole group, e.g. python + yt-dlp + ffmpeg.
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
  } catch {
    // Best-effort: the process may already be gone.
  }
}

/**
 * Cancel a job: kill whatever tool is running for it (COLMAP / Brush / python)
 * and stop the pipeline from starting the next stage. Returns false if the job
 * had already finished. The pipeline's catch block sees job.cancelled and
 * leaves status as 'cancelled' instead of 'error'.
 */
export function cancelJob(job) {
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    return false
  }
  job.cancelled = true
  job.status = 'cancelled'
  job.error = 'Cancelled by user'
  appendLog(job, '\nCancelled by user.')
  if (job.child) killChild(job.child)
  return true
}

/**
 * Spawn a child process and resolve on exit 0, reject otherwise.
 * Streams stdout/stderr into the job log, and lets an optional onData hook
 * parse lines for progress. With timeoutMs, the tool is killed if it runs
 * longer than that.
 */
function run(job, bin, args, { cwd, onData, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    // Cancelled between stages: don't start the next tool.
    if (job.cancelled) return reject(new Error('Cancelled by user'))
    appendLog(job, `\n$ ${path.basename(bin)} ${args.join(' ')}`)
    // windowsHide: no console window per tool on Windows. detached (macOS /
    // Linux only): put the tool in its own process group so killChildren can
    // take down its subprocesses too; stdio stays piped so it doesn't outlive
    // us unnoticed.
    const child = spawn(bin, args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    liveChildren.add(child)
    job.child = child

    const handle = (buf) => {
      const text = buf.toString()
      for (const line of text.split(/\r?\n/)) {
        appendLog(job, line)
        if (onData) onData(line)
      }
    }
    child.stdout.on('data', handle)
    child.stderr.on('data', handle)

    child.on('error', (err) => {
      clearTimeout(timer)
      liveChildren.delete(child)
      if (job.child === child) job.child = null
      reject(new Error(`Failed to start ${bin}: ${err.message}`))
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      liveChildren.delete(child)
      if (job.child === child) job.child = null
      if (job.cancelled) reject(new Error('Cancelled by user'))
      else if (code === 0) resolve()
      else if (code === null)
        reject(new Error(`${path.basename(bin)} was killed (${signal ?? 'terminated'})`))
      else reject(new Error(`${path.basename(bin)} exited with code ${code}`))
    })
  })
}

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/
const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

/**
 * Return https://www.youtube.com/watch?v=<id> for a single-video YouTube URL,
 * or null for anything else (other hosts, playlists, channels, bad IDs).
 * Rebuilding from the ID alone also strips list=/index= so yt-dlp can never be
 * handed a playlist. tools/youtube_frames.py applies the same rule.
 */
export function canonicalYoutubeUrl(input) {
  let u
  try {
    u = new URL(String(input).trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password || u.port) return null
  const host = u.hostname.toLowerCase()
  let id = null
  if (host === 'youtu.be') id = u.pathname.split('/')[1]
  else if (YT_HOSTS.has(host)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else id = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/)?.[1]
  }
  return id && YT_ID_RE.test(id) ? `https://www.youtube.com/watch?v=${id}` : null
}

/**
 * Extract frames from a YouTube URL into a job's images/ directory by running
 * tools/youtube_frames.py. Resolves with the number of frames written. The
 * script reports "PROGRESS <stage> <0..1>" lines, which drive job.detail, and
 * "ERROR: ..." lines, which become the job's error instead of a bare exit code.
 */
export async function extractYoutubeFrames(job, url, { fps, maxFrames } = {}) {
  const jobDir = path.join(config.jobsDir, job.id)
  const imagesDir = path.join(jobDir, 'images')
  await fsp.mkdir(imagesDir, { recursive: true })

  job.status = 'running'
  job.phase = 'extract'
  job.progress = 0
  job.detail = 'Fetching video info…'

  // Extraction owns the 0..0.05 slice of the bar (COLMAP starts at 0.05);
  // job.detail carries the finer-grained per-stage percentage.
  let scriptError = null
  const onData = (line) => {
    const p = line.match(/^PROGRESS (download|extract) ([\d.]+)/)
    if (p) {
      const frac = Number(p[2])
      const pct = Math.round(frac * 100)
      if (p[1] === 'download') {
        job.progress = 0.03 * frac
        job.detail = `Downloading video… ${pct}%`
      } else {
        job.progress = 0.03 + 0.02 * frac
        job.detail = `Extracting frames… ${pct}%`
      }
      return
    }
    const e = line.match(/^ERROR:\s*(.+)/)
    if (e) scriptError = e[1]
  }

  try {
    await run(
      job,
      config.pythonBin,
      [
        config.ytScript,
        url,
        '--output', imagesDir,
        '--fps', String(fps ?? config.ytFps),
        '--max-frames', String(maxFrames ?? config.ytMaxFrames),
        '--max-duration', String(config.ytMaxDurationSec),
        // Lets yt-dlp use this very Node binary as its JavaScript runtime.
        '--node-path', process.execPath,
      ],
      { onData, timeoutMs: config.ytTimeoutMin * 60_000 },
    )
  } catch (err) {
    if (scriptError && !job.cancelled) throw new Error(scriptError)
    throw err
  } finally {
    job.detail = null
  }

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
          'try a longer clip or a higher fps.',
      )
    }
  } catch (err) {
    if (!job.cancelled) {
      job.status = 'error'
      job.error = err.message
      appendLog(job, `\nERROR: ${err.message}`)
    }
    return
  }
  await runPipeline(job)
}

/**
 * Full reconstruction pipeline for one job directory.
 * Layout produced (INRIA/COLMAP convention that Brush reads):
 *   <jobDir>/images/              uploaded photos (or extracted video frames)
 *   <jobDir>/database.db          COLMAP feature database
 *   <jobDir>/sparse/0/            COLMAP sparse model (poses + points)
 *   <jobsDir>/<id>_out/           Brush splat .ply exports
 *   <jobsDir>/<id>_out/result.ply the export normalized into the viewer's frame
 */
export async function runPipeline(job) {
  const jobDir = path.join(config.jobsDir, job.id)
  const imagesDir = path.join(jobDir, 'images')
  const dbPath = path.join(jobDir, 'database.db')
  const sparseDir = path.join(jobDir, 'sparse')

  try {
    if (job.cancelled) return
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
        config.brushItersFlag, String(config.trainIters),
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
      ? (await fsp.readdir(outDir)).filter(
          (f) => f.toLowerCase().endsWith('.ply') && f !== 'result.ply',
        )
      : []
    if (plys.length === 0) {
      throw new Error('Training finished but no .ply was exported.')
    }
    plys.sort() // splat_00500, splat_07000 ... lexical works with zero-padding
    const rawPly = path.join(outDir, plys[plys.length - 1])

    // --- Normalize into the viewer's frame ---
    // COLMAP reconstructs in an arbitrary world frame (object far from the
    // origin, arbitrary scale), which loads but can render off-screen in the
    // viewer. Recenter + rescale into result.ply. The PLY header, including
    // Brush's "Vertical axis" comment the viewer reads, is preserved verbatim.
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
    if (job.cancelled) return // cancelJob already set status/error
    job.status = 'error'
    job.error = err.message
    appendLog(job, `\nERROR: ${err.message}`)
  }
}

export { makeJob }
