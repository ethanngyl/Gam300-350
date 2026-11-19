/*!************************************************************************
\file performance.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 07-11-2026
\brief
Business logic: measures how fast the API answers (per route) and how fast
the website loads (reported by browsers), and works out p50 / p95 / p99.
Percentiles can't be added together, so each minute keeps a histogram:
counts per time range (BUCKET_EDGES_MS). Minutes and machines' histograms
can then be added, and a percentile is read from the total by
interpolating inside its range, so it is accurate to within that range
(about +-25%). Counts, means and maximums are exact. No req / res.
Measurements build up in memory, go into the database (table perf_minutes)
every PERF_FLUSH_SEC seconds and at shutdown, and are deleted after
PERF_KEEP_DAYS days. Each machine measures itself.
- BUCKET_EDGES_MS / bucketIndex(ms) / percentile(buckets, p, maxMs)
The histogram and reading a percentile from it.
- PAGE_LOAD_METRICS
The page-load measures browsers send: ttfb, fcp, domContentLoaded, load.
- recordTiming(kind, name, ms, { error })
Counts one measurement ('api' with a route name, or 'page' with a measure).
- flushTimings()
Writes what has built up to the database now.
- startPerformance()
Starts the regular writes and the daily-limit deletes (every machine).
- performanceReport(window)
p50 / p95 / p99, mean, max and counts per route and per page-load measure
over the last '1h', '24h' or '7d'.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { config } from '../config.js'
import { addPerfMinutes, deletePerfOlderThan, listPerfMinutes } from '../db.js'

// Upper edge of each time range, in ms; one more range holds anything slower.
export const BUCKET_EDGES_MS = [
  1, 2, 3, 5, 7.5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750,
  1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 30000, 60000,
]
export const PAGE_LOAD_METRICS = ['ttfb', 'fcp', 'domContentLoaded', 'load']
export const REPORT_WINDOWS = { '1h': 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000 }

const MINUTE_MS = 60 * 1000
const PRUNE_EVERY_MS = 60 * 60 * 1000
// Not yet in the database: key "kind \0 name \0 minute" -> summary.
const pending = new Map()
let started = false

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Which time range a measurement falls in.
  \param ms
  number
  \return
    index into a histogram (BUCKET_EDGES_MS.length for the slowest range)
*/
/************************************************************************/
export function bucketIndex(ms)
{
  const index = BUCKET_EDGES_MS.findIndex((edge) => ms <= edge)
  return index === -1 ? BUCKET_EDGES_MS.length : index
}

function emptySummary()
{
  return { count: 0, errors: 0, sumMs: 0, maxMs: 0, buckets: new Array(BUCKET_EDGES_MS.length + 1).fill(0) }
}

function addInto(total, part)
{
  total.count += part.count
  total.errors += part.errors
  total.sumMs += part.sumMs
  total.maxMs = Math.max(total.maxMs, part.maxMs)
  part.buckets.forEach((n, i) => { total.buckets[i] += n })
  return total
}

/************************************************************************/
/*!
  \brief
    A percentile from a histogram, interpolated inside its time range.
    The slowest range ends at the exact maximum, and no result is above it.
  \param buckets
    number[] (counts per range)
  \param p
  number
    0-100, e.g. 95
  \param maxMs
  number
    The exact slowest measurement
  \return
    ms (rounded to 0.1), or null when there are no measurements
*/
/************************************************************************/
export function percentile(buckets, p, maxMs)
{
  const count = buckets.reduce((sum, n) => sum + n, 0)
  if (count === 0) return null
  const target = (p / 100) * count
  let before = 0
  for (let i = 0; i < buckets.length; i++)
  {
    if (buckets[i] === 0) continue
    if (before + buckets[i] >= target)
    {
      const low = i === 0 ? 0 : BUCKET_EDGES_MS[i - 1]
      const high = i < BUCKET_EDGES_MS.length ? Math.min(BUCKET_EDGES_MS[i], maxMs) : maxMs
      const value = low + ((target - before) / buckets[i]) * (high - low)
      return Math.round(Math.min(value, maxMs) * 10) / 10
    }
    before += buckets[i]
  }
  return Math.round(maxMs * 10) / 10
}

/************************************************************************/
/*!
  \brief
    Counts one measurement in the current minute.
  \param kind
    'api' (name: a route, e.g. "GET /jobs/:id") or 'page' (name: one of
    PAGE_LOAD_METRICS)
  \param name
  string
  \param ms
  number
  \param error
  bool, optional: the reply was a server error (5xx)
*/
/************************************************************************/
export function recordTiming(kind, name, ms, { error = false } = {})
{
  if (!Number.isFinite(ms) || ms < 0) return
  const minute = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS
  const key = `${kind}\0${name}\0${minute}`
  let summary = pending.get(key)
  if (!summary)
  {
    summary = { kind, name, minute, ...emptySummary() }
    pending.set(key, summary)
  }
  summary.count++
  if (error) summary.errors++
  summary.sumMs += ms
  summary.maxMs = Math.max(summary.maxMs, ms)
  summary.buckets[bucketIndex(ms)]++
}

/************************************************************************/
/*!
  \brief
    Writes the measurements built up in memory to the database (added to
    any already stored for the same minute). Never throws: a failed write
    is logged and those measurements are dropped.
*/
/************************************************************************/
export function flushTimings()
{
  if (pending.size === 0) return
  const rows = [...pending.values()]
  pending.clear()
  try
  {
    addPerfMinutes(rows)
  }
  catch (err)
  {
    console.warn(`[backend] performance: could not save ${rows.length} minute summaries: ${err.message}`)
  }
}

/************************************************************************/
/*!
  \brief
    Deletes summaries older than PERF_KEEP_DAYS.
  \return
    How many were deleted
*/
/************************************************************************/
export function prunePerformance()
{
  return deletePerfOlderThan(Date.now() - config.perfKeepDays * 24 * 60 * 60 * 1000)
}

/************************************************************************/
/*!
  \brief
    Starts writing measurements to the database every PERF_FLUSH_SEC and
    deleting old ones hourly (now as well). Runs on every machine. Safe to
    call twice.
*/
/************************************************************************/
export function startPerformance()
{
  if (started) return
  started = true
  setInterval(flushTimings, config.perfFlushSec * 1000).unref()
  prunePerformance()
  setInterval(prunePerformance, PRUNE_EVERY_MS).unref()
}

/************************************************************************/
/*!
  \brief
    The report for GET /metrics/performance: everything measured in the
    window (saved and not yet saved), per route and per page-load measure.
  \param window
    '1h' | '24h' | '7d'
  \return
    { window, from, to, api: [{ route, count, errors, mean, p50, p95,
    p99, max }] (slowest p95 first), pageLoad: [{ metric, count, mean,
    p50, p95, p99, max }] }, all times in ms
*/
/************************************************************************/
export function performanceReport(window)
{
  const to = Date.now()
  const from = to - REPORT_WINDOWS[window]
  // Whole minutes that overlap the window.
  const since = Math.floor(from / MINUTE_MS) * MINUTE_MS
  const totals = new Map()
  for (const row of [...listPerfMinutes(since), ...[...pending.values()].filter((s) => s.minute >= since)])
  {
    const key = `${row.kind}\0${row.name}`
    if (!totals.has(key)) totals.set(key, { kind: row.kind, name: row.name, ...emptySummary() })
    addInto(totals.get(key), row)
  }

  const describe = (total) => ({
    count: total.count,
    mean: Math.round((total.sumMs / total.count) * 10) / 10,
    p50: percentile(total.buckets, 50, total.maxMs),
    p95: percentile(total.buckets, 95, total.maxMs),
    p99: percentile(total.buckets, 99, total.maxMs),
    max: Math.round(total.maxMs * 10) / 10,
  })
  const all = [...totals.values()].filter((total) => total.count > 0)
  return {
    window,
    from,
    to,
    api: all.filter((t) => t.kind === 'api')
      .map((t) => ({ route: t.name, errors: t.errors, ...describe(t) }))
      .map(({ route, count, errors, ...rest }) => ({ route, count, errors, ...rest }))
      .sort((a, b) => b.p95 - a.p95),
    pageLoad: all.filter((t) => t.kind === 'page')
      .sort((a, b) => PAGE_LOAD_METRICS.indexOf(a.name) - PAGE_LOAD_METRICS.indexOf(b.name))
      .map((t) => ({ metric: t.name, ...describe(t) })),
  }
}
// ----- End of Functions ----------------------------------------------------- //
