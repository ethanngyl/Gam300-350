# API changelog

The backend's HTTP API is versioned in its path: `/api/v1/...`. Every change
to the API is recorded here, newest first.

## Compatibility policy

- **Adding** an endpoint, an optional request field or a reply field doesn't
  break clients. It goes into the current version and is listed below.
- **Removing or renaming** a field, changing its type or meaning, or removing
  an endpoint breaks clients. Such a change goes into a **new version**
  (`/api/v2/...`) served alongside the old one, which keeps working until no
  client uses it.
- **Legacy paths:** the original unversioned paths (`/auth/me`, `/jobs`,
  `/library/...`, ...) are **deprecated** and frozen. They keep answering
  exactly as before, with two extra headers: `Deprecation` (RFC 9745) and
  `Link: </api/v1/...>; rel="successor-version"`. The website and the
  engine moved to `/api/v1` on 2026-11-07; the legacy paths stay for the
  clients not moved yet:
  - team machines on a build from before 2026-11-03;
  - website and engine builds from before 2026-11-07.

  They will only be removed once nothing uses them, and that removal will be
  listed here.
- **The contract:** [`packages/src/backend/openapi.yaml`](../packages/src/backend/openapi.yaml)
  (also served at `GET /api/v1/openapi.yaml`) describes every v1 endpoint,
  with example requests and responses. CI (`npm test`) checks the server
  still matches it, so a breaking change can't slip into v1 unnoticed.
- **Shared code:** both versions run the same route code (`server.js` mounts
  it twice). `adapters/apiVersions.js` holds the only differences.
- **Database changes** are numbered migrations (`packages/src/backend/migrations/`),
  listed below. Never edit a committed migration; add a new one.

## v1 additions: 2026-11-07 (nothing breaks)

- `POST /metrics/page-load`: the website reports how long it took to load
  (`ttfb`, `fcp`, `domContentLoaded`, `load`, in ms). Public; at most 30 per
  IP address per minute. The website sends it once per page load.
- `GET /metrics/performance?window=1h|24h|7d` (admins): p50 / p95 / p99,
  mean, slowest and counts for every API route (slowest p95 first) and for
  the page-load measures. Each machine reports its own numbers, kept 7 days
  (`PERF_KEEP_DAYS`).
- Database migration 5 (`005_performance.sql`) adds the `perf_minutes` table.

## Clients moved to v1: 2026-11-07 (no API change)

- The website calls every endpoint under `/api/v1/...`, including the URLs
  it builds itself (`/api/v1/jobs/<id>/result.ply`) and the start of Google
  sign-in (`/api/v1/auth/google`). The Feedback inbox reads `createdAt` as
  milliseconds.
- The engine (`engine/src/net/BackendClient.cpp`) prefixes every request
  with `/api/v1`. It never read user dates, and job dates were already
  milliseconds, so nothing else changed.
- Google's callback still comes back to `GOOGLE_REDIRECT_URI` (see below).

## v1 additions: 2026-11-03 (later the same day; nothing breaks)

- `GET /openapi.yaml`: the OpenAPI 3.1 description of the API. Public.
- Legacy (unversioned) replies carry `Deprecation` and
  `Link: rel="successor-version"` headers. Their bodies are unchanged.
- **Team machines now call the VM on `/api/v1/...`** (`/api/v1/register`,
  `/api/v1/verify-account`, `/api/v1/library/...`). **Update the VM first**:
  a VM on an older build has no `/api/v1`, so sign-in and the shared library
  would stop working on updated team machines. Replies are converted with
  the same adapters, so the website sees no difference.
- Job URLs from the VM's library (`thumbnail`, `cover`, `images[].url`) are
  given the version the browser asked for: `/api/v1/jobs/...` in v1,
  `/jobs/...` on the legacy paths.
- Google sign-in still returns to whatever `GOOGLE_REDIRECT_URI` names; both
  `/auth/google/callback` and `/api/v1/auth/google/callback` work. To move
  it, add the v1 URL in Google Cloud Console, then change
  `GOOGLE_REDIRECT_URI` in the VM's `.env`.

## v1: 2026-11-03

First versioned API. Every legacy endpoint also exists under `/api/v1`, with
these differences:

| Endpoint | Legacy (unversioned) | v1 |
|---|---|---|
| `GET /auth/me`, and the user in `POST /auth/login` / `POST /auth/signup` replies | `createdAt`: ISO text, `"2026-10-04T08:15:00Z"` | `createdAt`: UTC epoch milliseconds, `1791101700000` |
| `GET /auth/me/account`, and account replies from `PATCH /auth/me`, `POST /auth/me/password`, `PUT` / `DELETE /auth/me/avatar` | `createdAt`, `passwordChangedAt`: ISO text | milliseconds |
| `GET /feedback` | `items[].createdAt`: ISO text | milliseconds |
| `GET /jobs` | `thumbnail`, `cover`, `images[].url`: `/jobs/...` | `/api/v1/jobs/...` |

Job dates (`createdAt`, `updatedAt` in `GET /jobs`, `GET /jobs/:id`) were
already milliseconds and are unchanged.

New in both v1 and legacy:

- `GET /catalog`: the reference data (feedback categories, training presets,
  the photo minimum) plus the upload limits. Public.
- `GET /scenes`, `POST /scenes`, `GET` / `PUT` / `DELETE /scenes/:id`: Scene
  Builder scenes saved to the account, in the versioned scene format
  (`schemas/scene.v1.schema.json`). An older scene sent by the website is
  converted. On team machines these pass to the VM (`/library/scenes`).
- Any path the API doesn't have answers `404 { error }` (JSON) instead of an
  HTML page.
- `GET /jobs` lists jobs from the sources set by `JOB_SOURCES` (default
  `live`, as before). With `sample`, read-only sample jobs appear, and
  `GET /jobs/:id`, `/images/:name` and `/result.ply` work for them.

Removed: `GET /wiki` and `GET /wiki/:page`, the only routes that sent HTML
pages. Nothing used them.

### Database migrations in this release

| # | File | Change |
|---|---|---|
| 1 | `001_baseline.js` | The schema as it was before migrations. It completes any older `app.db`, adding `role`, `google_sub`, `password_changed_at`, `origin` and `bytes` where missing. |
| 2 | `002_drop_uploads.sql` | Drops the `uploads` table, which was never used. |
| 3 | `003_timestamps_ms.js` | Every date column becomes INTEGER milliseconds (`users`, `jobs`, `feedback`, `synced_jobs`). `feedback.category` is checked against the catalog instead of a fixed list. |
| 4 | `004_scenes.sql` | Adds the `scenes` table. |
| 5 | `005_performance.sql` | Adds the `perf_minutes` table (2026-11-07). |

The first start after updating backs `app.db` up (`data/app.db.bak-<time>`),
then migrates it.

### Moving the website to v1 (frontend to-do, for Bryan)

Steps 1 and 3 are done (2026-11-07); 2, 4 and 5 are still open.

1. **Done.** Every API call is prefixed with `/api/v1`, including the URLs
   built by hand (`/api/v1/jobs/<id>/result.ply`).
2. Fix the "Last edited" sort in `LibraryScreen.jsx:37` and
   `ImageGallery.jsx:159`. They call `Date.parse(job.updatedAt)`, but job
   dates are numbers, so the result is `NaN` and the sort does nothing (this
   is already broken today). Use `new Date(x).getTime()`.
3. **Done.** With v1, `createdAt` of users, the account and feedback items
   is a number. The Feedback inbox now turns it into ISO text for its
   `<time dateTime>`; everything else already went through `new Date(...)`.
4. Read `GET /api/v1/catalog` instead of the copies in
   `FeedbackCategories.js`, `TrainingPresets.js` and `FrameExtractor.jsx`
   (`MAX_MEDIA_FILES`, `MAX_MEDIA_SIZE_MB`), plus `MIN_PHOTOS = 8` in
   `PhotoEditorScreen.jsx`.
5. Set `SCENES_API_READY = true` in `SceneStorage.js`, so scenes are saved to
   the account. Scenes already in the browser can be moved with
   `PUT /api/v1/scenes/<their id>`; the server converts them.
