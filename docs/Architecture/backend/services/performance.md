# `backend/services/performance.js`

*Author: Gabriel.* Measures **how fast the API answers** (per route) and **how fast the website loads** (as reported by browsers), and works out p50, p95 and p99. Percentiles cannot simply be added together, so each minute keeps a **histogram**: a count for each time range in `BUCKET_EDGES_MS`. Histograms from different minutes and machines can then be added, and a percentile is read from the total by interpolating inside its range. That makes it accurate to within the range (about ±25%). Counts, means and maximums are exact. Measurements build up in memory, are written to `perf_minutes` every `PERF_FLUSH_SEC` seconds and at shutdown, and are deleted after `PERF_KEEP_DAYS` days. Each machine measures itself.

## Constants
- `BUCKET_EDGES_MS`: `1, 2, 3, 5, 7.5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 30000, 60000`, plus one more range for anything slower.
- `PAGE_LOAD_METRICS`: `ttfb`, `fcp`, `domContentLoaded`, `load`. The browser sends these from [frontend/pageLoadTiming](../../frontend/web-app/utilities.md).
- `REPORT_WINDOWS`: `1h`, `24h`, `7d`.
- `pending`: a Map keyed by `kind\0name\0minute`, holding summaries not yet in the database.

## Functions
| Function | Behaviour |
|---|---|
| `bucketIndex(ms)` | The first edge that `ms` is at or below, or the last range if it is slower than all of them. |
| `emptySummary()` *(private)* | `{ count: 0, errors: 0, sumMs: 0, maxMs: 0, buckets: zeros }`. |
| `addInto(total, part)` *(private)* | Adds the counts, errors, sums and buckets element by element, and keeps the larger maximum. |
| `percentile(buckets, p, maxMs)` | Finds the bucket containing the `p`-th share of the count and **interpolates linearly** between its lower and upper edges. The upper edge is capped at the exact `maxMs`, so no result is above the real maximum. Rounded to 0.1 ms. Returns `null` with no measurements. |
| `recordTiming(kind, name, ms, { error })` | Ignores values that are not finite or are negative. Adds one measurement to the current minute's summary for `kind` (`api` with a route name, or `page` with a page-load measure). |
| `flushTimings()` | Moves every pending summary to `addPerfMinutes`, which **adds** them to existing rows. Never throws; a failed write is logged and those measurements are dropped. |
| `prunePerformance()` | Deletes summaries older than `perfKeepDays` and returns the count. |
| `startPerformance()` | Safe to call more than once. Flushes every `perfFlushSec`, prunes now and then hourly. Both timers are `unref`'d. |
| `performanceReport(window)` | Covers every **whole minute** that overlaps the window, combining the saved rows and pending rows that have not been written yet. Totals are added up per `(kind, name)`. Returns `{ window, from, to, api: [{ route, count, errors, mean, p50, p95, p99, max }]` sorted **slowest p95 first**, `pageLoad: [{ metric, … }]` in `PAGE_LOAD_METRICS` order `}`. |
