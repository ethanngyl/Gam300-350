/*!************************************************************************
\file pipeline.js
\author1 Xiong Yang
\author2 Gabriel Sebastian Putra
\par DP email1: xiong.yang@digipen.edu
\par DP email2: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 30-09-2026
\brief
The reconstruction engine. It holds the in-memory job store and runs the
photos -> COLMAP -> Brush -> normalized .ply pipeline for each job, plus the
YouTube frame extraction step in front of it. It starts and tracks every tool
process (COLMAP, Brush, python) so jobs can be cancelled and nothing is left
running on the GPU when the server stops.
- makeJob(id)
Creates a new queued job with default values and adds it to the jobs map.
- appendLog(job, line)
Adds a trimmed line to the job's log, keeping only the last 400 lines.
- setPhase(job, phase, progress)
Moves a job into a new phase and saves it straight away (never throttled).
- killChildren()
Kills every running tool process. Synchronous so it works in exit handlers.
- killChild(child)
Kills one tool process and everything it spawned (taskkill /T on Windows,
the whole process group elsewhere).
- cancelJob(job)
Marks a job as cancelled and kills its running tool. Returns false if the
job had already finished.
- run(job, bin, args, { cwd, onData, timeoutMs })
Starts a tool process, streams its output into the job log, and resolves on
exit code 0 or rejects with a readable error otherwise.
- canonicalYoutubeUrl(input)
Turns any single-video YouTube link into https://www.youtube.com/watch?v=<id>,
or returns null for anything else (playlists, channels, other sites).
- extractYoutubeFrames(job, url, { fps, maxFrames })
Runs tools/youtube_frames.py to download a video and save frames into the
job's images/ folder. Returns the number of frames written.
- runYoutubePipeline(job, url, opts)
Extracts the frames, checks there are at least 8, then runs runPipeline.
- runPipeline(job)
The full reconstruction: COLMAP features, matching and mapping, Brush
training, normalizing the .ply, and copying it into the engine's samples.
- restoreJob(record)
Rebuilds an in-memory job from a record scanned off disk (see scan.js).
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'
import { highestRawPly, IMAGE_EXT_RE } from './scan.js'
import { saveJob } from './status.js'

/************************************************************************/
/*!
  \brief
    In-memory job store. Jobs run from memory, and each state change is
    also written to <jobsDir>/<id>/status.json (see status.js) so scan.js
    can restore them after a restart. Each job:
      { id, status, phase, progress, log[], error, createdAt, resultPath }
    status: queued | running | done | error | cancelled
    phase:  upload | extract | colmap-features | colmap-matching |
            colmap-mapping | training | normalize | done
*/
/************************************************************************/
export const jobs = new Map()

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Create a new job with default values (queued, upload phase, no
    progress) and add it to the jobs map.
  \param id
    string
    The id of the job
  \return
    The new job.
*/
/************************************************************************/
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
    detail: null, // short human-readable sub-status, e.g. "Downloading video… 40%"
    cancelled: false, // set by cancelJob(); makes the pipeline stop between stages
    child: null, // the tool process currently running for this job, if any
  }
  jobs.set(id, job)
  return job
}

/************************************************************************/
/*!
  \brief
    Add a line to the job's log with trailing whitespace removed. Empty
    lines are skipped, and only the last 400 lines are kept so long runs
    don't grow unbounded in memory.
  \param job
    The job to log to
  \param line
    string
    The line of output to add
  \return
    nothing
*/
/************************************************************************/
function appendLog(job, line) {
  const trimmed = String(line).replace(/\s+$/, '')
  if (!trimmed) return
  job.log.push(trimmed)
  // Keep the log bounded so long runs don't grow unbounded in memory.
  if (job.log.length > 400) job.log.splice(0, job.log.length - 400)
}

/************************************************************************/
/*!
  \brief
    Move a job into a new phase and persist it (phase changes are never
    throttled).
  \param job
    The job to update
  \param phase
    string
    The new phase, e.g. 'colmap-features' or 'training'
  \param progress
    number
    The progress to set, from 0 to 1
  \return
    Saves the job.
*/
/************************************************************************/
function setPhase(job, phase, progress) {
  job.phase = phase
  job.progress = progress
  saveJob(job)
}

/************************************************************************/
/*!
  \brief
    Every tool process currently running (COLMAP, Brush, python). Tracked
    so the server can terminate them on shutdown -- on Windows a child is
    NOT killed when its parent Node process dies, so without this a
    restart leaves Brush training as an orphan, hogging the GPU for a job
    nobody can poll anymore.
*/
/************************************************************************/
const liveChildren = new Set()

/************************************************************************/
/*!
  \brief
    Terminate every live tool process (and their own children, e.g. the
    yt-dlp/ffmpeg that youtube_frames.py spawns). Synchronous on purpose
    so it is safe to call from process 'exit' handlers, where async work
    never runs.
  \return
    nothing
*/
/************************************************************************/
export function killChildren() {
  for (const child of liveChildren) killChild(child)
}

/************************************************************************/
/*!
  \brief
    Terminate one tool process and everything it spawned. Synchronous.
    Best-effort: does nothing if the process has already exited.
  \param child
    ChildProcess
    The tool process to kill
  \return
    nothing
*/
/************************************************************************/
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

/************************************************************************/
/*!
  \brief
    Cancel a job: kill whatever tool is running for it (COLMAP / Brush /
    python) and stop the pipeline from starting the next stage. The
    pipeline's catch block sees job.cancelled and leaves status as
    'cancelled' instead of 'error'.
  \param job
    The job to cancel
  \return
    bool, false if the job had already finished, true if it was cancelled
*/
/************************************************************************/
export function cancelJob(job) {
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    return false
  }
  job.cancelled = true
  job.status = 'cancelled'
  job.error = 'Cancelled by user'
  appendLog(job, '\nCancelled by user.')
  saveJob(job)
  if (job.child) killChild(job.child)
  return true
}

/************************************************************************/
/*!
  \brief
    Spawn a child process and resolve on exit 0, reject otherwise.
    Streams stdout/stderr into the job log, and lets an optional onData
    hook parse lines for progress. With timeoutMs, the tool is killed if
    it runs longer than that.
  \param job
    The job the tool is running for
  \param bin
    string
    The path to the executable
  \param args
    string[]
    The command-line arguments
  \param cwd
    string
    Optional. The folder to run the tool in
  \param onData
    function
    Optional. Called with each line of output
  \param timeoutMs
    number
    Optional. Kill the tool after this many milliseconds
  \return
    Promise that resolves on exit code 0, else rejects with an error for
    cancellation, timeout, a kill signal or a non-zero exit code
*/
/************************************************************************/
function run(job, bin, args, { cwd, onData, timeoutMs, env } = {}) {
  return new Promise((resolve, reject) => {
    // Cancelled between stages: don't start the next tool.
    if (job.cancelled) return reject(new Error('Cancelled by user'))
    appendLog(job, `\n$ ${path.basename(bin)} ${args.join(' ')}`)
    // windowsHide: no console window per tool on Windows. detached (macOS /
    // Linux only): put the tool in its own process group so killChildren can
    // take down its subprocesses too; stdio stays piped so it doesn't outlive
    // us unnoticed. env (when given) is merged over the inherited environment.
    const child = spawn(bin, args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: env ? { ...process.env, ...env } : undefined,
    })
    liveChildren.add(child)
    job.child = child

    // Optional watchdog: kill the tool if it runs longer than timeoutMs (used
    // for the YouTube download/extract). timedOut is read by the close handler
    // below to reject with a clear "timed out" message; the log line surfaces
    // the same in the job log. clearTimeout is a no-op when timer is null.
    let timedOut = false
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          killChild(child)
        }, timeoutMs)
      : null

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
      else if (timedOut)
        reject(new Error(`${path.basename(bin)} timed out after ${+(timeoutMs / 60000).toFixed(1)} min`))
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

/************************************************************************/
/*!
  \brief
    Rebuild a single-video YouTube URL from its ID alone. This also strips
    list=/index= so yt-dlp can never be handed a playlist.
    tools/youtube_frames.py applies the same rule.
  \param input
    string
    The link the user entered
  \return
    https://www.youtube.com/watch?v=<id> for a single-video YouTube URL,
    null for anything else (other hosts, playlists, channels, bad IDs).
*/
/************************************************************************/
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

/************************************************************************/
/*!
  \brief
    Extract frames from a YouTube URL into a job's images/ directory by
    running tools/youtube_frames.py. The script reports
    "PROGRESS <stage> <0..1>" lines, which drive job.detail, and
    "ERROR: ..." lines, which become the job's error instead of a bare
    exit code.
  \param job
    The job to extract frames for
  \param url
    string
    The canonical YouTube video URL
  \param fps
    number
    Optional. Frames per second to extract, defaults to config.ytFps
  \param maxFrames
    number
    Optional. Cap on frames extracted, defaults to config.ytMaxFrames
  \return
    The number of frames written to images/.
*/
/************************************************************************/
export async function extractYoutubeFrames(job, url, { fps, maxFrames } = {}) {
  const jobDir = path.join(config.jobsDir, job.id)
  const imagesDir = path.join(jobDir, 'images')
  await fsp.mkdir(imagesDir, { recursive: true })

  job.status = 'running'
  job.phase = 'extract'
  job.progress = 0
  job.detail = 'Fetching video info…'
  saveJob(job)

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
      saveJob(job, { throttle: true })
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
    if (scriptError && !job.cancelled) throw new Error(scriptError, { cause: err })
    throw err
  } finally {
    job.detail = null
  }

  const frames = (await fsp.readdir(imagesDir)).filter((f) =>
    IMAGE_EXT_RE.test(f),
  )
  return frames.length
}

/************************************************************************/
/*!
  \brief
    Create a reconstruction job seeded from a YouTube URL: extract frames,
    then run the normal reconstruction pipeline. Intended to be called in
    the background (not awaited) after responding to the client.
  \param job
    The job to run
  \param url
    string
    The canonical YouTube video URL
  \param opts
    object
    Optional { fps, maxFrames }, passed to extractYoutubeFrames
  \return
    nothing; sets the job to error if fewer than 8 frames were extracted
    or extraction failed
*/
/************************************************************************/
export async function runYoutubePipeline(job, url, opts = {}) {
  try {
    const count = await extractYoutubeFrames(job, url, opts)
    job.imageCount = count
    saveJob(job)
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
      saveJob(job)
    }
    return
  }
  await runPipeline(job)
}

// Shown for any flavor of "mapper couldn't build a model from these photos":
// it exiting non-zero (e.g. no good initial image pair) and it exiting 0 but
// writing no sparse model both mean the same thing to the user.
const NO_MODEL_MESSAGE =
  'COLMAP could not reconstruct a model from these photos. Try more photos with more overlap and texture.'

/************************************************************************/
/*!
  \brief
    Full reconstruction pipeline for one job directory.
    Layout produced (INRIA/COLMAP convention that Brush reads):
      <jobDir>/images/              uploaded photos (or extracted frames)
      <jobDir>/database.db          COLMAP feature database
      <jobDir>/sparse/0/            COLMAP sparse model (poses + points)
      <jobsDir>/<id>_out/           Brush splat .ply exports
      <jobsDir>/<id>_out/result.ply the export normalized into the
                                    viewer's frame
  \param job
    The job to run
  \return
    nothing; sets the job to done with a resultPath, or to error with a
    message (left as cancelled if the user cancelled it)
*/
/************************************************************************/
export async function runPipeline(job) {
  const jobDir = path.join(config.jobsDir, job.id)
  const imagesDir = path.join(jobDir, 'images')
  const dbPath = path.join(jobDir, 'database.db')
  const sparseDir = path.join(jobDir, 'sparse')

  try {
    if (job.cancelled) return
    job.status = 'running'

    // --- COLMAP: feature extraction ---
    setPhase(job, 'colmap-features', 0.05)
    await run(job, config.colmapBin, [
      'feature_extractor',
      '--database_path', dbPath,
      '--image_path', imagesDir,
      '--ImageReader.single_camera', '1',
      config.colmapExtractionUseGpuFlag, config.colmapUseGpu,
    ])

    // --- COLMAP: exhaustive matching ---
    setPhase(job, 'colmap-matching', 0.2)
    await run(job, config.colmapBin, [
      'exhaustive_matcher',
      '--database_path', dbPath,
      config.colmapMatchingUseGpuFlag, config.colmapUseGpu,
    ])

    // --- COLMAP: sparse mapping (recovers camera poses) ---
    setPhase(job, 'colmap-mapping', 0.35)
    await fsp.mkdir(sparseDir, { recursive: true })
    try {
      await run(job, config.colmapBin, [
        'mapper',
        '--database_path', dbPath,
        '--image_path', imagesDir,
        '--output_path', sparseDir,
      ])
    } catch (err) {
      // Cancellation and timeouts already have a clear, specific message -- only
      // COLMAP's own failure (e.g. "no good initial image pair") gets replaced.
      // The raw COLMAP output is still in the job's log / logTail for debugging.
      if (job.cancelled || /timed out/.test(err.message)) throw err
      throw new Error(NO_MODEL_MESSAGE, { cause: err })
    }

    // Mapper writes sparse/0 (sometimes 1,2.. if it splits). Require at least one.
    const models = fs.existsSync(sparseDir)
      ? (await fsp.readdir(sparseDir)).filter((d) => /^\d+$/.test(d))
      : []
    if (models.length === 0) {
      throw new Error(NO_MODEL_MESSAGE)
    }

    // --- Brush: train the gaussian splat ---
    setPhase(job, 'training', 0.45)
    const outDirName = `${job.id}_out`
    const total = config.trainIters
    // Brush (brush-cli 1.0.0) renders its progress as an interactive bar that is
    // suppressed when stdout is a pipe, so with default logging it prints NOTHING
    // for us to parse. Setting RUST_LOG=info makes it emit structured log lines,
    // several of which carry the current step, e.g.
    //   brush_train::train] screen_size iter=200 n=176 ...
    //   brush_cli] Refine iter 401, 243 splats.
    // These appear roughly every 200 steps -- frequent enough for a live counter.
    const iterRe = /\biter[= ](\d[\d,]*)/i
    await run(
      job,
      config.brushBin,
      [
        job.id, // dataset dir name, relative to cwd (jobsDir)
        '--max-resolution', String(config.maxResolution),
        config.brushItersFlag, String(total),
        '--export-path', `./${outDirName}/`,
        '--export-name', 'splat_{iter}.ply',
        '--export-every', String(total),
      ],
      {
        cwd: config.jobsDir,
        env: { RUST_LOG: 'info' },
        onData: (line) => {
          const m = line.match(iterRe)
          if (m) {
            const cur = Number(m[1].replace(/,/g, ''))
            if (cur >= 0 && cur <= total) {
              // Map training [0..1] onto the 0.45..0.98 band.
              job.progress = 0.45 + 0.53 * (cur / total)
              // Surfaced by the frontend as a live iteration counter.
              job.detail = `Iteration ${cur.toLocaleString()} / ${total.toLocaleString()}`
              saveJob(job, { throttle: true })
            }
          }
        },
      },
    )
    // Training done -- drop the iteration counter so later phases don't show it.
    job.detail = null

    // --- Locate the exported .ply (highest iteration) ---
    const outDir = path.join(config.jobsDir, outDirName)
    const rawPly = await highestRawPly(outDir)
    if (!rawPly) {
      throw new Error('Training finished but no .ply was exported.')
    }

    // --- Normalize into the viewer's frame ---
    // COLMAP reconstructs in an arbitrary world frame (object far from the
    // origin, arbitrary scale), which loads but can render off-screen in the
    // viewer. Recenter + rescale into result.ply. The PLY header, including
    // Brush's "Vertical axis" comment the viewer reads, is preserved verbatim.
    setPhase(job, 'normalize', 0.99)
    const finalPly = path.join(outDir, 'result.ply')
    try {
      await run(job, config.pythonBin, [config.normalizeScript, rawPly, finalPly])
      job.resultPath = finalPly
    } catch (err) {
      // Best-effort: if normalization fails, still hand back the raw export.
      appendLog(job, `\nNormalization failed (${err.message}); serving raw export.`)
      job.resultPath = rawPly
    }

    // Best-effort copy into the engine's samples folder, so a finished scan can
    // be opened straight from the native viewer's file browser (main.cpp scans
    // assets/samples/ for *.ply on launch). Never fails the job -- the result is
    // still servable from resultPath/the Download button either way.
    try {
      fs.mkdirSync(config.engineSamplesDir, { recursive: true })
      const enginePath = path.join(config.engineSamplesDir, `${job.id.slice(0, 8)}.ply`)
      fs.copyFileSync(job.resultPath, enginePath)
      appendLog(job, `Copied to engine samples: ${enginePath}`)
    } catch (err) {
      appendLog(job, `Could not copy to engine samples (${err.message}); use Download .ply instead.`)
    }

    job.phase = 'done'
    job.progress = 1
    job.status = 'done'
    appendLog(job, `\nDone. Result: ${job.resultPath}`)
    saveJob(job)
  } catch (err) {
    if (job.cancelled) return // cancelJob already set status/error
    job.status = 'error'
    job.error = err.message
    appendLog(job, `\nERROR: ${err.message}`)
    saveJob(job)
  }
}

/************************************************************************/
/*!
  \brief
    Re-create an in-memory job from a record scanned off disk (see
    scan.js), so jobs finished before a restart can still be polled and
    downloaded.
  \param record
    The job record returned by scanJob
  \return
    The restored job, also added to the jobs map.
*/
/************************************************************************/
export function restoreJob(record) {
  const job = makeJob(record.id)
  Object.assign(job, {
    status: record.status,
    phase: record.phase,
    progress: record.progress,
    error: record.error,
    createdAt: record.createdAt,
    resultPath: record.resultPath,
    imageCount: record.imageCount,
    source: record.source,
    updatedAt: record.updatedAt,
    log: [...(record.logTail ?? [])], // so /jobs/:id still has a log tail after a restart
  })
  // Backfill a missing record, or persist a reconciled state (e.g. running -> interrupted).
  if (record.needsWrite) saveJob(job)
  return job
}

// ----- End of Functions ----------------------------------------------------- //

export { makeJob }
