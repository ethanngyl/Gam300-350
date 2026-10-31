# Pipeline Metrics dashboard

A standalone web app for the generation stats that `src/backend/metrics.js`
records for every finished reconstruction. It runs separately from the main
web app (own server, own port, own build) and only **reads** metrics files.
It never talks to the reconstruction backend.

## What it reads

| File | Written by | Contents |
|---|---|---|
| `src/backend/jobs/<id>/metrics.json` | `recordPlyMetrics()` | One run's full record |
| `src/backend/jobs/<id>/status.json` | `saveJob()` | Fallback for runs with no metrics.json: a partial record (no phase timings or hardware) |
| `src/backend/jobs/metrics.jsonl` | `recordPlyMetrics()` | Every run, one JSON object per line |

Both are merged by `jobId`. The per-job file wins, and the `.jsonl` keeps runs
whose job folder was deleted. Both files are committed to git (see
`.gitignore`), so teammates' runs show up after a pull.

## Tabs

- **Overview**: KPIs (runs, median total / training time, iterations per
  second, splat count, machines), total time per run over time, and a phase
  breakdown of the 10 most recent runs.
- **Metrics**: every record in a sortable, paginated table. Search by job id,
  host or GPU and filter by source or machine. Export the filtered set as CSV
  or JSON. Click a row to see the full record, including the raw JSON.
- **Hardware**: training throughput and median times per host + GPU, with
  each machine's spec.

Tabs are linkable (`#/overview`, `#/metrics`, `#/hardware`). Data refreshes
every 30 s while the tab is visible. Light and dark themes follow the OS
setting unless you override them.

## Running it

From `packages/`:

```sh
npm run metrics:start   # build + serve on http://localhost:5010
npm run metrics:dev     # hot reload on http://localhost:5174 (also run: npm run metrics:server)
```

On Windows you can also double-click `packages/start-metrics.bat`.

| Env var | Default | Purpose |
|---|---|---|
| `METRICS_PORT` | `5010` | Port the dashboard server listens on |
| `METRICS_HOST` | `127.0.0.1` | Bind address. Set `0.0.0.0` to expose it on the LAN |
| `METRICS_JOBS_DIR` | `JOBS_DIR`, else `../backend/jobs` | Where to read metrics from |

The server binds to localhost by default because the records include host
names and hardware details.

## API

| Route | Returns |
|---|---|
| `GET /api/health` | `{ ok, uptimeSec }` |
| `GET /api/metrics` | `{ generatedAt, count, sources: { files, log, invalid }, records[] }`, newest first |
| `GET /api/metrics/:jobId` | One record, or 404 |

## Layout

```
metrics-dashboard/
  server.js            Express API + static hosting of dist/
  dist/                build output (gitignored)
  web/
    index.html, main.jsx, App.jsx, styles.css
    lib/               data layer (fetch, aggregation, CSV), formatters, hooks, scales
    components/        charts (SVG, no chart library), runs table, detail drawer, KPI tiles
    views/             one file per tab
```

The build config is `packages/vite.metrics.config.js`.
