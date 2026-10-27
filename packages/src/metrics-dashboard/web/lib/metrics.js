/*!************************************************************************
\file metrics.js
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Data layer for the metrics dashboard: fetching, the pipeline phase
catalogue, aggregation, machine grouping and CSV export. Kept free of
React so it can be unit-tested on its own.
- fetchMetrics(signal)
GET /api/metrics, throws with the server's message on failure.
- PHASES / phaseMeta(key)
Pipeline phases in run order, each with a label and a chart colour slot.
- median(values) / mean(values)
- summarize(records)
Headline figures for the KPI row.
- machineKey(record) / groupByMachine(records)
Groups runs by host + GPU so hardware can be compared.
- COLUMNS / toCsv(records)
The runs table's columns, shared by the table and the CSV export.
**************************************************************************/

import { fmtBytes, fmtDate, fmtDuration, fmtInt, fmtNum, shortId } from './format.js'

export async function fetchMetrics(signal) {
  const res = await fetch('/api/metrics', { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }
  return res.json()
}

// Run order from backend/pipeline.js. The colour slot order is the
// validated categorical order, so adjacent stacked segments stay distinct
// under colour-vision deficiency.
export const PHASES = [
  { key: 'masking', label: 'Masking', color: 'var(--series-1)' },
  { key: 'colmap-features', label: 'COLMAP features', color: 'var(--series-2)' },
  { key: 'colmap-matching', label: 'COLMAP matching', color: 'var(--series-3)' },
  { key: 'colmap-mapping', label: 'COLMAP mapping', color: 'var(--series-4)' },
  { key: 'training', label: 'Training', color: 'var(--series-5)' },
  { key: 'normalize', label: 'Normalize', color: 'var(--series-6)' },
]
const OTHER_PHASE = { key: 'other', label: 'Other', color: 'var(--series-other)' }

export const phaseMeta = (key) => PHASES.find((p) => p.key === key) ?? { ...OTHER_PHASE, label: key }

// Phase seconds in run order, unknown phases folded into "Other".
export function orderedPhases(record) {
  const src = record.timing?.phasesSec ?? {}
  const out = PHASES.filter((p) => src[p.key] > 0).map((p) => ({ ...p, sec: src[p.key] }))
  const other = Object.entries(src)
    .filter(([k, v]) => !PHASES.some((p) => p.key === k) && v > 0)
    .reduce((a, [, v]) => a + v, 0)
  if (other > 0) out.push({ ...OTHER_PHASE, sec: other })
  return out
}

const nums = (values) => values.filter((v) => typeof v === 'number' && Number.isFinite(v))

export function median(values) {
  const v = nums(values).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

export function mean(values) {
  const v = nums(values)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

export const gpuName = (r) => r.hardware?.gpus?.[0]?.name ?? 'Unknown GPU'
export const hostName = (r) => r.hardware?.host ?? 'Unknown host'

export function summarize(records) {
  return {
    runs: records.length,
    medianTotalSec: median(records.map((r) => r.timing?.totalSec)),
    medianColmapSec: median(records.map((r) => r.timing?.colmapSec)),
    medianTrainingSec: median(records.map((r) => r.timing?.trainingSec)),
    meanItersPerSec: mean(records.map((r) => r.training?.itersPerSec)),
    medianSplats: median(records.map((r) => r.output?.splatCount)),
    totalBytes: nums(records.map((r) => r.output?.finalPlyBytes)).reduce((a, b) => a + b, 0),
    machines: new Set(records.map(machineKey)).size,
    lastRunAt: records[0]?.finishedAt ?? null,
  }
}

export const machineKey = (r) => `${hostName(r)} · ${gpuName(r)}`

export function groupByMachine(records) {
  const groups = new Map()
  for (const r of records) {
    const key = machineKey(r)
    if (!groups.has(key)) groups.set(key, { key, host: hostName(r), gpu: gpuName(r), hardware: r.hardware, runs: [] })
    groups.get(key).runs.push(r)
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      count: g.runs.length,
      medianTotalSec: median(g.runs.map((r) => r.timing?.totalSec)),
      medianTrainingSec: median(g.runs.map((r) => r.timing?.trainingSec)),
      meanItersPerSec: mean(g.runs.map((r) => r.training?.itersPerSec)),
      peakVramMB: Math.max(0, ...nums(g.runs.map((r) => r.gpuDuringTraining?.peakVramUsedMB))) || null,
    }))
    .sort((a, b) => (b.meanItersPerSec ?? -1) - (a.meanItersPerSec ?? -1))
}

// One definition per column: how to read it, sort it, show it and export it.
export const COLUMNS = [
  { key: 'finishedAt', label: 'Finished', get: (r) => r.finishedAt, fmt: fmtDate },
  { key: 'jobId', label: 'Job', get: (r) => r.jobId, fmt: shortId, mono: true },
  { key: 'source', label: 'Source', get: (r) => r.source ?? 'upload', fmt: (v) => v },
  { key: 'images', label: 'Images', get: (r) => r.input?.imageCount, fmt: fmtInt, num: true },
  { key: 'total', label: 'Total', get: (r) => r.timing?.totalSec, fmt: fmtDuration, num: true },
  { key: 'colmap', label: 'COLMAP', get: (r) => r.timing?.colmapSec, fmt: fmtDuration, num: true },
  { key: 'training', label: 'Training', get: (r) => r.timing?.trainingSec, fmt: fmtDuration, num: true },
  { key: 'iters', label: 'Iterations', get: (r) => r.training?.iterationsTarget, fmt: fmtInt, num: true },
  { key: 'itps', label: 'Iter/s', get: (r) => r.training?.itersPerSec, fmt: (v) => fmtNum(v), num: true },
  { key: 'splats', label: 'Splats', get: (r) => r.output?.splatCount, fmt: fmtInt, num: true },
  { key: 'size', label: 'Size', get: (r) => r.output?.finalPlyBytes, fmt: fmtBytes, num: true },
  { key: 'vram', label: 'Peak VRAM', get: (r) => r.gpuDuringTraining?.peakVramUsedMB, fmt: (v) => (v == null ? '—' : `${fmtInt(v)} MB`), num: true },
  { key: 'gpu', label: 'GPU', get: gpuName, fmt: (v) => v },
  { key: 'host', label: 'Host', get: hostName, fmt: (v) => v },
]

function csvCell(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Raw values (seconds, bytes), not the display strings, so the CSV is
// usable in a spreadsheet.
export function toCsv(records) {
  const header = COLUMNS.map((c) => csvCell(c.label)).join(',')
  const rows = records.map((r) => COLUMNS.map((c) => csvCell(c.get(r))).join(','))
  return [header, ...rows].join('\r\n')
}

export function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
