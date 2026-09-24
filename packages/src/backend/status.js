// Persists each job's state as <jobsDir>/<id>/status.json so it survives a
// server restart. Jobs still live in memory while running; this file is the
// durable copy that scan.js reads back on startup.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { config } from './config.js'

export const STATUS_FILE = 'status.json'
const VERSION = 1
const VALID_STATUS = new Set(['queued', 'running', 'done', 'error', 'cancelled'])
const TERMINAL_STATUS = new Set(['done', 'error', 'cancelled'])
// Progress updates arrive on nearly every log line; don't rewrite the file that often.
const THROTTLE_MS = 2000
const LOG_TAIL_LINES = 40

/**
 * Write the job's state to its folder. Synchronous on purpose: the record is
 * tiny, and the shutdown handler needs it to work where async never runs.
 * Never throws -- failing to persist must not fail a reconstruction.
 *
 * With `throttle`, skips the write if this job was saved less than 2s ago (for
 * progress-only updates). Phase changes and end states are always written.
 */
export function saveJob(job, { throttle = false } = {}) {
  const now = Date.now()
  if (throttle && job.savedAt && now - job.savedAt < THROTTLE_MS) return

  const jobDir = path.join(config.jobsDir, job.id)
  if (!fs.existsSync(jobDir)) return // folder was removed; don't recreate it

  job.updatedAt = now
  job.savedAt = now

  const record = {
    version: VERSION,
    id: job.id,
    status: job.status,
    phase: job.phase ?? null,
    progress: job.progress ?? 0,
    detail: job.detail ?? null,
    error: job.error ?? null,
    source: job.source ?? null,
    imageCount: job.imageCount ?? null,
    createdAt: job.createdAt,
    updatedAt: now,
    // Relative to jobsDir so moving JOBS_DIR doesn't break old records.
    result: job.resultPath
      ? path.relative(config.jobsDir, job.resultPath).split(path.sep).join('/')
      : null,
  }
  // Keep a log tail for finished jobs so a failure stays diagnosable after a restart.
  if (TERMINAL_STATUS.has(job.status)) record.logTail = job.log.slice(-LOG_TAIL_LINES)

  const file = path.join(jobDir, STATUS_FILE)
  const tmp = `${file}.tmp`
  const json = JSON.stringify(record, null, 2)
  try {
    // Write-then-rename so a crash mid-write can't leave a half-written record.
    fs.writeFileSync(tmp, json)
    try {
      fs.renameSync(tmp, file)
    } catch {
      // Windows can refuse to replace a file another process has open.
      fs.writeFileSync(file, json)
      fs.rmSync(tmp, { force: true })
    }
  } catch (err) {
    console.warn(`[backend] could not save status for job ${job.id}: ${err.message}`)
  }
}

/** Read a job's saved record, or null if missing, unreadable or not a valid record. */
export async function readStatus(id, jobsDir = config.jobsDir) {
  try {
    const record = JSON.parse(await fsp.readFile(path.join(jobsDir, id, STATUS_FILE), 'utf8'))
    if (record?.version !== VERSION || record.id !== id || !VALID_STATUS.has(record.status)) {
      return null
    }
    return record
  } catch {
    return null
  }
}
