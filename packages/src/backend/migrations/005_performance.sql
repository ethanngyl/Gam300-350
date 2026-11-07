-- add the perf_minutes table (API response times and website load times)
-- One row per kind ('api' or 'page'), name (a route such as "GET /jobs/:id",
-- or a page-load measure such as "load") and minute (UTC epoch ms at the start
-- of the minute). buckets is a JSON array of counts per time range
-- (services/performance.js BUCKET_EDGES_MS), so minutes can be added together
-- and percentiles read from the total. Kept PERF_KEEP_DAYS days.
CREATE TABLE IF NOT EXISTS perf_minutes (
  kind    TEXT    NOT NULL,
  name    TEXT    NOT NULL,
  minute  INTEGER NOT NULL,
  count   INTEGER NOT NULL,
  errors  INTEGER NOT NULL,
  sum_ms  REAL    NOT NULL,
  max_ms  REAL    NOT NULL,
  buckets TEXT    NOT NULL,
  PRIMARY KEY (kind, name, minute)
);
CREATE INDEX IF NOT EXISTS idx_perf_minutes_minute ON perf_minutes(minute);
