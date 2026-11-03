/*!************************************************************************
\file status.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 29-09-2026
\brief
Saves each job's state to <jobsDir>/<id>/status.json and reads it back. It's 
the saved-to-disk copy of the job that survives a restart. Running jobs still 
live in memory; scan.js reads these files back at startup. The file is short: 
constants followed by two exported functions.
- saveJob(job, { throttle })
Writes the job's current state to disk.
- readStatus(id, jobsDir)
Async. Reads and parses <jobsDir>/<id>/status.json, converting a record
from an older version (STATUS_UPGRADES) and checking it against
schemas/job-status.schema.json.
- upgradeStatus(record)
Brings a record of an older version up to STATUS_VERSION, or null for a
version this build can't read.
**************************************************************************/

// Persists each job's state as <jobsDir>/<id>/status.json so it survives a
// server restart. Jobs still live in memory while running; this file is the
// durable copy that scan.js reads back on startup.
// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'
import { validate } from './schemas.js'

export const STATUS_FILE = 'status.json'
// The record format version; the VM also writes it when storing a synced job.
// Format: schemas/job-status.schema.json. Changing or removing a field means
// a new version plus a converter from the old one in STATUS_UPGRADES.
export const STATUS_VERSION = 1
const VERSION = STATUS_VERSION
// Converters by the version they start from (none yet: every record ever
// written is version 1). Old ones are never removed, so any old record loads.
export const STATUS_UPGRADES = {}
// Jobs whose record is from a newer build, so the warning is logged once.
const warnedNewer = new Set()
const VALID_STATUS = new Set(['queued', 'running', 'done', 'error', 'cancelled'])
const TERMINAL_STATUS = new Set(['done', 'error', 'cancelled'])
// Progress updates arrive on nearly every log line; don't rewrite the file that often.
const THROTTLE_MS = 2000
const LOG_TAIL_LINES = 40

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Write the job's state to its folder. Synchronous on purpose: the record 
    is tiny, and the shutdown handler needs it to work where async never 
    runs. Never throws -- failing to persist must not fail a reconstruction.
  \param job
    The job to save
  \param throttle
    Recommended to set to false
  \return 
    Saves the Job.
*/
/************************************************************************/
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
        // Display name set from the Media Library; null shows the default name.
        name: job.name ?? null,
        // The copy's filename in the engine's samples folder; follows renames.
        sampleFile: job.sampleFile ?? null,
        imageCount: job.imageCount ?? null,
        removeBackground: job.removeBackground ?? false,
        trainIters: job.trainIters ?? null,
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

/************************************************************************/
/*!
  \brief
    Brings a record up to the current version, one version at a time.
  \param record
    A parsed status.json
  \return
    The record at STATUS_VERSION, or null if its version is missing, newer
    than this build, or has no converter
*/
/************************************************************************/
export function upgradeStatus(record) {
    let version = record?.version
    if (!Number.isInteger(version) || version > VERSION) return null
    let upgraded = record
    while (version < VERSION) {
        const convert = STATUS_UPGRADES[version]
        if (!convert) return null
        upgraded = convert(upgraded)
        version = upgraded.version
    }
    return upgraded
}

/************************************************************************/
/*!
  \brief
    Read a job's saved record, or null if missing, unreadable or not a
    valid record. A record from an older version is converted; one from a
    newer build is skipped with a warning (the job is then rebuilt from its
    folder, as for a missing record).
  \param id
    The job's ID.
  \param jobsDir
    The path to the job.
  \return
    Record of the job, else null.
*/
/************************************************************************/
export async function readStatus(id, jobsDir = config.jobsDir) {
    let record
    try {
        record = JSON.parse(await fsp.readFile(path.join(jobsDir, id, STATUS_FILE), 'utf8'))
    }
    catch
    {
        return null
    }
    if (record?.id !== id) return null
    if (Number.isInteger(record.version) && record.version > VERSION && !warnedNewer.has(id)) {
        warnedNewer.add(id)
        console.warn(`[backend] job ${id}: status.json is version ${record.version}, newer than this build reads (${VERSION}); ignoring it`)
    }
    const upgraded = upgradeStatus(record)
    if (!upgraded || !VALID_STATUS.has(upgraded.status) || validate('job-status', upgraded).length > 0) return null
    return upgraded
}

// ----- End of Functions ----------------------------------------------------- //