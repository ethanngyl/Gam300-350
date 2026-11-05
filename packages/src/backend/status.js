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
from an older version (STATUS_UPGRADES). Only a record without a usable id,
version or status is refused; any other field that breaks
schemas/job-status.schema.json is left out (the job then uses its default
for that field), so a hand-edited record keeps its name, status and error.
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
import { schemaErrors } from './schemas.js'

export const STATUS_FILE = 'status.json'
// The record format version; the VM also writes it when storing a synced job.
// Format: schemas/job-status.schema.json. Changing or removing a field means
// a new version plus a converter from the old one in STATUS_UPGRADES.
export const STATUS_VERSION = 1
const VERSION = STATUS_VERSION
// Converters by the version they start from (none yet: every record ever
// written is version 1). Old ones are never removed, so any old record loads.
export const STATUS_UPGRADES = {}
// Jobs already warned about (a record from a newer build / fields left out),
// so each warning is logged once.
const warnedNewer = new Set()
const warnedFields = new Set()
// Without these a record can't be used at all.
const CORE_FIELDS = new Set(['version', 'id', 'status'])
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
    Read a job's saved record, or null if missing, unreadable, for another
    id, or without a known status. A record from an older version is
    converted; one from a newer build is skipped with a warning (the job is
    then rebuilt from its folder, as for a missing record). Other fields
    that break the schema (e.g. a hand-edited progress of 7) are left out
    with one warning, and the rest of the record is kept.
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
    if (!upgraded || !VALID_STATUS.has(upgraded.status)) return null

    // Leave out just the fields that break the schema ("/progress",
    // "/logTail/3" -> progress, logTail); scan.js has a default for each.
    const badFields = new Set(schemaErrors('job-status', upgraded)
        .map((err) => err.instancePath.split('/')[1])
        .filter(Boolean))
    if ([...badFields].some((field) => CORE_FIELDS.has(field))) return null
    if (badFields.size === 0) return upgraded
    if (!warnedFields.has(id)) {
        warnedFields.add(id)
        console.warn(`[backend] job ${id}: status.json has invalid ${[...badFields].join(', ')}; ignoring those fields`)
    }
    return Object.fromEntries(Object.entries(upgraded).filter(([field]) => !badFields.has(field)))
}

// ----- End of Functions ----------------------------------------------------- //