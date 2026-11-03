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
  `/library/...`, ...) are frozen. They keep answering exactly as before, for
  the current website, the engine (`engine/src/net/BackendClient.cpp`) and
  team machines on an older build. Machines also talk to each other on the
  legacy paths, so a team machine works with an older VM and the other way
  round.
- **Shared code:** both versions run the same route code (`server.js` mounts
  it twice). `adapters/apiVersions.js` holds the only differences.
- **Database changes** are numbered migrations (`packages/src/backend/migrations/`),
  listed below. Never edit a committed migration; add a new one.

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

The first start after updating backs `app.db` up (`data/app.db.bak-<time>`),
then migrates it.

### Moving the website to v1 (frontend to-do, for Bryan)

The website keeps working unchanged on the legacy paths. To move it to v1:

1. Prefix every API call with `/api/v1` (one helper, for example
   `apiUrl(path)`), including the URLs built by hand: `App.jsx` (lines 409
   and 427) and `SceneBuilderScreen.jsx` (line 115) build
   `/jobs/<id>/result.ply`. Add `/api` to the Vite proxy in `vite.config.js`.
2. Fix the "Last edited" sort in `LibraryScreen.jsx:37` and
   `ImageGallery.jsx:159`. They call `Date.parse(job.updatedAt)`, but job
   dates are numbers, so the result is `NaN` and the sort does nothing (this
   is already broken today). Use `new Date(x).getTime()`.
3. With v1, `createdAt` of users, the account and feedback items is a number.
   The website only shows them through `new Date(...)` and `memberSince`,
   which already accept both.
4. Read `GET /api/v1/catalog` instead of the copies in
   `FeedbackCategories.js`, `TrainingPresets.js` and `FrameExtractor.jsx`
   (`MAX_MEDIA_FILES`, `MAX_MEDIA_SIZE_MB`), plus `MIN_PHOTOS = 8` in
   `PhotoEditorScreen.jsx`.
5. Set `SCENES_API_READY = true` in `SceneStorage.js`, so scenes are saved to
   the account. Scenes already in the browser can be moved with
   `PUT /api/v1/scenes/<their id>`; the server converts them.
