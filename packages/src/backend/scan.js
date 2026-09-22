// Turns the folders under config.jobsDir back into job records, so job state
// survives a server restart. Pure disk -> data (no Express, no in-memory Map);
// server.js decides how to merge these with live jobs.
//
// Layout it understands (written by runPipeline in pipeline.js):
//   <jobsDir>/<id>/images/         uploaded photos / extracted frames
//   <jobsDir>/<id>/database.db     COLMAP has started
//   <jobsDir>/<id>/sparse/         COLMAP mapping has started
//   <jobsDir>/<id>_out/result.ply  normalized result (else the newest splat_*.ply)

import fsp from 'node:fs/promises'
import path from 'node:path'

import { config } from './config.js'

export const IMAGE_EXT_RE = /\.(jpe?g|png)$/i
// Job ids become path segments, so only plain filename characters are accepted.
export const JOB_ID_RE = /^[\w-]+$/

async function exists(p) {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Newest raw Brush export in an `<id>_out` folder (excluding the normalized
 * result.ply), or null. Zero-padded names (splat_00500, splat_07000, ...) mean
 * a lexical sort finds the highest iteration.
 */
export async function highestRawPly(outDir) {
  let names
  try {
    names = await fsp.readdir(outDir)
  } catch {
    return null
  }
  const plys = names
    .filter((f) => f.toLowerCase().endsWith('.ply') && f !== 'result.ply')
    .sort()
  return plys.length ? path.join(outDir, plys[plys.length - 1]) : null
}

/**
 * Build a job record from one job folder, or null if it isn't a usable job
 * (bad id, no images, unreadable). Never throws, so one broken folder can't
 * take down a whole listing.
 *
 * The status is inferred from which files exist. The disk can't tell a running
 * job from an interrupted one, so callers must let a live in-memory job win.
 */
export async function scanJob(id, jobsDir = config.jobsDir) {
  if (!JOB_ID_RE.test(id) || id.endsWith('_out')) return null
  try {
    const jobDir = path.join(jobsDir, id)
    const names = (await fsp.readdir(path.join(jobDir, 'images')))
      .filter((n) => IMAGE_EXT_RE.test(n))
      .sort()
    if (names.length === 0) return null

    const st = await fsp.stat(jobDir)
    const outDir = path.join(jobsDir, `${id}_out`)
    const finalPly = path.join(outDir, 'result.ply')
    const resultPath = (await exists(finalPly)) ? finalPly : await highestRawPly(outDir)

    let status = 'queued'
    let phase = 'upload'
    let progress = 0
    let error = null
    if (resultPath) {
      status = 'done'
      phase = 'done'
      progress = 1
    } else if ((await exists(path.join(jobDir, 'sparse'))) || (await exists(path.join(jobDir, 'database.db')))) {
      // Reconstruction started but never produced a result.
      status = 'error'
      phase = null
      error = 'Interrupted -- the server stopped during processing.'
    }

    const images = names.map((name) => ({ name, url: `/jobs/${id}/images/${name}` }))
    return {
      id,
      status,
      phase,
      progress,
      error,
      // birthtime is 0 on some filesystems; fall back to mtime.
      createdAt: st.birthtimeMs || st.mtimeMs,
      imageCount: names.length,
      resultPath,
      hasResult: !!resultPath,
      thumbnail: images[0].url,
      images,
    }
  } catch {
    return null
  }
}

/** Scan every job folder, newest first. `<id>_out` folders are outputs, not jobs. */
export async function scanJobs(jobsDir = config.jobsDir) {
  let entries
  try {
    entries = await fsp.readdir(jobsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const records = await Promise.all(
    entries.filter((e) => e.isDirectory()).map((e) => scanJob(e.name, jobsDir)),
  )
  return records.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt)
}
