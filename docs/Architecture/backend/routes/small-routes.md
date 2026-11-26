# `backend/routes/sampleJobs.js`, `catalog.js`, `docs.js`, `metrics.js`

Four small routers, all by Gabriel.

---

## `routes/sampleJobs.js`
Read-only routes for **sample jobs** (when `JOB_SOURCES` includes `sample`, see [adapters/jobSources](../adapters/jobSources.md)). This router is **mounted before** `routes/jobs.js`. A request for any other job id passes through to it. Sample jobs can be listed, polled, viewed and downloaded by any signed-in user, but never changed: a rename or delete reaches `routes/jobs.js`, which finds no such job and answers 404.

- **`onlySampleJobs(req, _res, next)`**: sets `req.sample = findSampleJob(id)` when samples are on. If the id is not a sample, it calls `next('route')`, which hands the request to the next router.

| Route | Reply |
|---|---|
| `GET /jobs/:id` | The same shape as a real job's status: `status`, `phase` (`done`), `progress` (1 or 0), `imageCount`, `hasResult`, `logTail: []`. |
| `GET /jobs/:id/images/:name` | Only names **listed in the sample's entry**, otherwise 404. Sent with `sendFile` from `photosPath`. |
| `GET /jobs/:id/result.ply` | 404 unless the sample is done and has a model. `sendFile`, so byte ranges work. |
| `GET /jobs/:id/cover.webp` | Always 404: samples have no cut-out cover, so the cards show the first photo. |

---

## `routes/catalog.js`
### `GET /catalog`
**Public**, so the sign-in page can use it too. Returns `catalogForApi()`: `{ version, minPhotos, feedbackCategories, feedbackMessage, trainingPresets, defaultTrainingPreset, limits }` ([catalog.js](../catalog-schemas-ratelimit.md)). Clients read this instead of keeping their own copies.

---

## `routes/docs.js`
### `GET /openapi.yaml`
Sends `backend/openapi.yaml` as `application/yaml`. That is the API's own description (**OpenAPI 3.1**), with an example request and response for every endpoint. It can be opened in Swagger Editor or Redoc. A test (`tests/openapi.test.js`) checks it against the real routes.

---

## `routes/metrics.js`
Performance measurements ([services/performance](../services/performance.md)). Each machine reports its own numbers; nothing is passed on to the VM.

### `POST /metrics/page-load`
**Public**, because the page loads before anyone signs in. Limited to **30 per IP per minute**. The body may contain any of `ttfb`, `fcp`, `domContentLoaded` and `load`. Each value must be a finite number from 0 to **120 000 ms**; anything longer is a tab left loading, not a real page load. Other fields are ignored. Each valid value goes to `recordTiming('page', metric, ms)`. Returns **204**, or 400 if no valid value was sent.

### `GET /metrics/performance`
Admins only. `?window=1h|24h|7d` (default `24h`); any other value gives 400. Returns `performanceReport(window)`. The metrics dashboard's *Overview* and *Metrics* tabs show this.
