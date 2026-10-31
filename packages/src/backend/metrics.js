/*!************************************************************************
\file metrics.js
\author Ethan Ng
\par Course: csd3401f26
\par Software Engineering Project 5
\date 14-10-2026
\brief
Collects generation statistics for every .ply the pipeline produces: how long
each phase took, how many training iterations ran, how big the result is, and
what hardware it ran on. Each finished job gets <jobsDir>/<id>/metrics.json
and one line appended to <jobsDir>/metrics.jsonl, so runs on different
machines and settings can be compared afterwards (one JSON object per line).
Nothing here ever throws into the pipeline -- metrics are best-effort.
- getHardwareInfo()
Async, cached. CPU, RAM, OS, GPU(s) and COLMAP / Brush versions.
- startPhase(job, phase)
Closes the job's current phase timing and opens a new one.
- startGpuSampler(job)
Polls nvidia-smi during training for peak VRAM / average utilisation.
Returns a stop function. No-op without an NVIDIA driver.
- readPlyHeader(file)
Async. Returns { vertexCount, properties, format } from a .ply header.
- recordPlyMetrics(job, { rawPly, finalPly, normalized })
Async. Builds the metrics record, writes it to disk and the job log.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { config } from './config.js'

export const METRICS_FILE = 'metrics.json'
export const METRICS_LOG = 'metrics.jsonl'
const VERSION = 1
const GPU_SAMPLE_MS = 5000

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Run a command and resolve with its stdout, or null if it can't be run,
    exits non-zero or takes longer than the timeout. Never rejects.
*/
/************************************************************************/
function tryExec(bin, args, timeout = 10_000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) return resolve(null)
      resolve(`${stdout ?? ''}${stderr ?? ''}`)
    })
  })
}

/************************************************************************/
/*!
  \brief
    List NVIDIA GPUs through nvidia-smi.
  \return
    [{ name, vramMB, driver, vendor }] or null without an NVIDIA driver.
*/
/************************************************************************/
async function nvidiaGpus() {
  const out = await tryExec('nvidia-smi', [
    '--query-gpu=name,memory.total,driver_version',
    '--format=csv,noheader,nounits',
  ])
  if (!out) return null
  const gpus = out
    .split(/\r?\n/)
    .map((l) => l.split(',').map((s) => s.trim()))
    .filter((p) => p.length >= 3 && p[0])
    .map(([name, mem, driver]) => ({ name, vramMB: Number(mem) || null, driver, vendor: 'NVIDIA' }))
  return gpus.length ? gpus : null
}

/************************************************************************/
/*!
  \brief
    List GPUs on Windows. Win32_VideoController.AdapterRAM is a 32-bit
    field (caps at 4 GB), so VRAM comes from the display class registry
    keys instead, which hold the real 64-bit size.
  \return
    [{ name, vramMB, driver }] or null if the query fails.
*/
/************************************************************************/
async function windowsGpus() {
  const script =
    "Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | " +
    "Where-Object { $_.DriverDesc } | ForEach-Object { [pscustomobject]@{ " +
    "name = $_.DriverDesc; vram = [int64]$_.'HardwareInformation.qwMemorySize'; driver = $_.DriverVersion } } | " +
    'ConvertTo-Json -Compress'
  const out = await tryExec('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])
  if (!out?.trim()) return null
  try {
    const parsed = JSON.parse(out)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    // Skip virtual adapters (e.g. Microsoft Basic Display, remote desktop) that report no memory.
    const gpus = list
      .filter((g) => g.name && g.vram > 0)
      .map((g) => ({ name: g.name, vramMB: Math.round(g.vram / 2 ** 20), driver: g.driver ?? null }))
    return gpus.length ? gpus : null
  } catch {
    return null
  }
}

/************************************************************************/
/*!
  \brief
    List GPUs on macOS via system_profiler.
  \return
    [{ name, vramMB, driver }] or null if the query fails.
*/
/************************************************************************/
async function macGpus() {
  const out = await tryExec('system_profiler', ['SPDisplaysDataType', '-json'], 20_000)
  try {
    const list = JSON.parse(out).SPDisplaysDataType ?? []
    const gpus = list.map((g) => ({
      name: g.sppci_model ?? g._name,
      // Apple Silicon shares system memory, so there is no VRAM figure.
      vramMB: parseInt(g.spdisplays_vram ?? g.spdisplays_vram_shared, 10) * 1024 || null,
      driver: null,
      cores: g.sppci_cores ? Number(g.sppci_cores) : undefined,
    }))
    return gpus.length ? gpus : null
  } catch {
    return null
  }
}

/************************************************************************/
/*!
  \brief
    List GPUs on Linux via lspci (names only).
  \return
    [{ name, vramMB: null, driver: null }] or null if lspci isn't there.
*/
/************************************************************************/
async function linuxGpus() {
  const out = await tryExec('lspci', [])
  if (!out) return null
  const gpus = out
    .split(/\r?\n/)
    .filter((l) => /VGA compatible|3D controller|Display controller/i.test(l))
    .map((l) => ({ name: l.replace(/^.*?:\s*/, '').replace(/^.*?:\s*/, ''), vramMB: null, driver: null }))
  return gpus.length ? gpus : null
}

/************************************************************************/
/*!
  \brief
    First line of a tool's version / help output, e.g.
    "COLMAP 4.2.0 (Commit be5e291 on 2026-08-31 with CUDA)".
*/
/************************************************************************/
async function toolVersion(bin, args) {
  const out = await tryExec(bin, args)
  return out?.split(/\r?\n/).find((l) => l.trim())?.trim() ?? null
}

let hardwarePromise = null

/************************************************************************/
/*!
  \brief
    Describe the machine the pipeline runs on. Probed once and cached --
    the hardware doesn't change while the server is up.
  \return
    Promise of { host, os, cpu, memory, gpus, tools, node }.
*/
/************************************************************************/
export function getHardwareInfo() {
  hardwarePromise ??= (async () => {
    const cpus = os.cpus()
    const gpuProbe =
      process.platform === 'win32' ? windowsGpus
      : process.platform === 'darwin' ? macGpus
      : linuxGpus
    const [nvidia, other, colmap, brush] = await Promise.all([
      nvidiaGpus(),
      gpuProbe(),
      toolVersion(config.colmapBin, ['-h']),
      toolVersion(config.brushBin, ['--version']),
    ])
    return {
      host: os.hostname(),
      os: {
        platform: process.platform,
        release: os.release(),
        version: typeof os.version === 'function' ? os.version() : null,
        arch: os.arch(),
      },
      cpu: {
        model: cpus[0]?.model?.trim() ?? null,
        logicalCores: cpus.length,
        speedMHz: cpus[0]?.speed ?? null,
      },
      memory: { totalMB: Math.round(os.totalmem() / 2 ** 20) },
      // nvidia-smi gives the most accurate NVIDIA figures; the OS probe covers everything else.
      gpus: nvidia ?? other ?? [],
      tools: {
        colmap,
        colmapUseGpu: config.colmapUseGpu === '1',
        brush,
      },
      node: process.version,
    }
  })().catch((err) => ({ error: err.message }))
  return hardwarePromise
}

/************************************************************************/
/*!
  \brief
    Close the job's open phase timing (if any) and start timing a new one.
    Called from setPhase in pipeline.js, so every phase change is timed.
  \param job
    The job to time
  \param phase
    string
    The phase now starting, e.g. 'colmap-features' or 'training'
  \return
    nothing
*/
/************************************************************************/
export function startPhase(job, phase) {
  const now = Date.now()
  job.metrics ??= { startedAt: now, phases: [] }
  const open = job.metrics.phases.at(-1)
  if (open && open.endedAt == null) open.endedAt = now
  if (phase) job.metrics.phases.push({ phase, startedAt: now, endedAt: null })
}

/************************************************************************/
/*!
  \brief
    While Brush trains, poll nvidia-smi for VRAM used and GPU utilisation
    so the record shows how hard the GPU was pushed. Only NVIDIA exposes
    this from the command line, so other GPUs record nothing.
  \param job
    The job being trained
  \return
    A function that stops sampling and stores the summary on job.metrics.
*/
/************************************************************************/
export function startGpuSampler(job) {
  const samples = []
  let stopped = false
  let timer = null
  const tick = async () => {
    const out = await tryExec(
      'nvidia-smi',
      ['--query-gpu=memory.used,utilization.gpu', '--format=csv,noheader,nounits'],
      4000,
    )
    if (stopped) return
    if (!out) return // no NVIDIA driver: give up quietly
    const [mem, util] = out.split(/\r?\n/)[0].split(',').map((s) => Number(s.trim()))
    if (Number.isFinite(mem)) samples.push({ mem, util })
    timer = setTimeout(tick, GPU_SAMPLE_MS)
  }
  tick()
  return () => {
    stopped = true
    clearTimeout(timer)
    if (!samples.length) return
    job.metrics ??= { startedAt: Date.now(), phases: [] }
    job.metrics.gpuDuringTraining = {
      samples: samples.length,
      peakVramUsedMB: Math.max(...samples.map((s) => s.mem)),
      avgUtilizationPct: Math.round(samples.reduce((a, s) => a + s.util, 0) / samples.length),
    }
  }
}

/************************************************************************/
/*!
  \brief
    Read just the header of a .ply file (stops at end_header).
  \param file
    string
    Path to the .ply
  \return
    { format, vertexCount, properties[] } or null if it can't be read.
*/
/************************************************************************/
export async function readPlyHeader(file) {
  let fh
  try {
    fh = await fsp.open(file, 'r')
    const buf = Buffer.alloc(64 * 1024)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    const text = buf.subarray(0, bytesRead).toString('latin1')
    const end = text.indexOf('end_header')
    if (!text.startsWith('ply') || end < 0) return null
    const lines = text.slice(0, end).split(/\r?\n/)
    let vertexCount = null
    let inVertex = false
    const properties = []
    let format = null
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts[0] === 'format') format = parts[1]
      else if (parts[0] === 'element') {
        inVertex = parts[1] === 'vertex'
        if (inVertex) vertexCount = Number(parts[2])
      } else if (parts[0] === 'property' && inVertex) properties.push(parts.at(-1))
    }
    return { format, vertexCount, properties }
  } catch {
    return null
  } finally {
    await fh?.close()
  }
}

/************************************************************************/
/*!
  \brief
    Size of a file in bytes, or null if it can't be stat'ed.
*/
/************************************************************************/
async function fileSize(file) {
  try {
    return (await fsp.stat(file)).size
  } catch {
    return null
  }
}

/************************************************************************/
/*!
  \brief
    Seconds with one decimal place, from a millisecond duration.
*/
/************************************************************************/
const secs = (ms) => (ms == null ? null : Math.round(ms / 100) / 10)

/************************************************************************/
/*!
  \brief
    Build the metrics record for a job whose .ply was just generated,
    write it to the job folder as metrics.json, append it to the global
    metrics.jsonl, and put a one-line summary in the job log.
    Best-effort: errors are logged, never thrown.
  \param job
    The job that produced the .ply
  \param rawPly
    string
    Brush's exported .ply
  \param finalPly
    string
    The .ply handed to the user (result.ply, or rawPly if normalize failed)
  \param normalized
    bool
    Whether normalize_ply.py succeeded
  \param log
    function
    Optional. Called with the summary line (pipeline.js passes appendLog)
  \return
    Promise of the record, or null if building it failed.
*/
/************************************************************************/
export async function recordPlyMetrics(job, { rawPly, finalPly, normalized, log } = {}) {
  try {
    startPhase(job, null) // close the last phase
    const m = job.metrics ?? { startedAt: job.createdAt, phases: [] }
    const finishedAt = Date.now()

    const phaseMs = {}
    for (const p of m.phases) {
      phaseMs[p.phase] = (phaseMs[p.phase] ?? 0) + ((p.endedAt ?? finishedAt) - p.startedAt)
    }
    const phases = Object.fromEntries(Object.entries(phaseMs).map(([k, v]) => [k, secs(v)]))
    const colmapSec = secs(
      ['colmap-features', 'colmap-matching', 'colmap-mapping'].reduce((a, k) => a + (phaseMs[k] ?? 0), 0),
    )
    const trainingSec = phases.training ?? null
    const itersDone = m.lastIteration ?? null

    const [hardware, header, rawBytes, finalBytes] = await Promise.all([
      getHardwareInfo(),
      readPlyHeader(finalPly),
      fileSize(rawPly),
      fileSize(finalPly),
    ])

    const record = {
      version: VERSION,
      jobId: job.id,
      source: job.source ?? null,
      createdAt: new Date(job.createdAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      timing: {
        // Pipeline start -> .ply ready. Excludes time spent uploading / queued.
        totalSec: secs(finishedAt - m.startedAt),
        // Including upload / queue time, from the moment the job was created.
        sinceCreatedSec: secs(finishedAt - job.createdAt),
        colmapSec,
        trainingSec,
        phasesSec: phases,
      },
      training: {
        iterationsTarget: config.trainIters,
        // Highest step Brush reported; it logs every ~200 steps, so this may
        // trail the target slightly even though Brush ran to completion.
        lastIterationLogged: itersDone,
        itersPerSec:
          trainingSec && config.trainIters ? Math.round((config.trainIters / trainingSec) * 10) / 10 : null,
        maxResolution: config.maxResolution,
      },
      input: {
        imageCount: job.imageCount ?? null,
        sparseModels: m.sparseModels ?? null,
        youtube: job.source === 'youtube' ? { fps: m.ytFps ?? null, maxFrames: m.ytMaxFrames ?? null } : undefined,
      },
      output: {
        splatCount: header?.vertexCount ?? null,
        plyFormat: header?.format ?? null,
        propertiesPerSplat: header?.properties.length ?? null,
        rawPlyBytes: rawBytes,
        finalPlyBytes: finalBytes,
        normalized: !!normalized,
        rawPly: rawPly ? path.relative(config.jobsDir, rawPly).split(path.sep).join('/') : null,
        finalPly: finalPly ? path.relative(config.jobsDir, finalPly).split(path.sep).join('/') : null,
      },
      gpuDuringTraining: m.gpuDuringTraining ?? null,
      hardware,
    }

    const json = JSON.stringify(record, null, 2)
    await fsp.writeFile(path.join(config.jobsDir, job.id, METRICS_FILE), json)
    fs.appendFileSync(path.join(config.jobsDir, METRICS_LOG), `${JSON.stringify(record)}\n`)

    const gpuName = hardware.gpus?.[0]?.name ?? 'unknown GPU'
    const summary =
      `Metrics: ${record.timing.totalSec}s total (COLMAP ${record.timing.colmapSec}s, ` +
      `training ${trainingSec ?? '?'}s), ${config.trainIters} iters, ` +
      `${record.output.splatCount?.toLocaleString() ?? '?'} splats, ` +
      `${((finalBytes ?? 0) / 2 ** 20).toFixed(1)} MB on ${gpuName}`
    log?.(summary)
    console.log(`[backend] job ${job.id}: ${summary}`)
    return record
  } catch (err) {
    console.warn(`[backend] could not record metrics for job ${job.id}: ${err.message}`)
    return null
  }
}

// ----- End of Functions ----------------------------------------------------- //
