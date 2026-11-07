# Genesis web app: architecture

The website turns photos or videos of an object into a 3D Gaussian Splat
model. It is split into a **frontend** (React, in the browser), a **backend**
(Node.js / Express) and **data** (SQLite and job folders), and the backend is
itself split into layers. The frontend never touches the database: it only
calls the backend's HTTP API, which replies with JSON or file data (photos,
`.ply` models), never pages. Any other client can use the same API without
backend changes:
- the engine (`engine/src/net/BackendClient.cpp`, C++/Qt);
- the curl test client (`packages/api-tests/`);
- Postman, or a mobile app.

The API is versioned (`/api/v1/...`; the original unversioned paths stay,
deprecated, for older clients). See [api-changelog.md](api-changelog.md).
The full API reference, with an example request and response for every
endpoint, is [`packages/src/backend/openapi.yaml`](../packages/src/backend/openapi.yaml)
(OpenAPI 3.1, also served at `GET /api/v1/openapi.yaml`). Open it in
[Swagger Editor](https://editor.swagger.io) or Redoc to browse. The data
formats, tables and naming rules are in [data-schema.md](data-schema.md).

## Layers

```mermaid
flowchart TB
    subgraph clients["Clients (presentation)"]
        web["Web app<br/>packages/src/web-app<br/>React: all UI, 3D viewing"]
        engine["Engine<br/>engine/src/net/BackendClient.cpp"]
        curl["API smoke test<br/>packages/api-tests (curl)"]
    end

    subgraph backend["Backend: packages/src/backend"]
        server["server.js<br/>startup, wiring, shutdown"]
        subgraph api["API layer (/api/v1 and legacy paths)"]
            routes["routes/<br/>jobs, sampleJobs, libraryStore, auth,<br/>account, feedback, scenes, catalog"]
            middleware["middleware/<br/>session, limits, uploads, sendDbModel, errors"]
        end
        subgraph adapters["Adapters"]
            versions["adapters/apiVersions.js<br/>v1 / legacy reply shapes"]
            sources["adapters/jobSources/<br/>folders, vmLibrary, sample -> JobSummary"]
        end
        subgraph logic["Business logic layer"]
            services["services/<br/>jobs, accounts, authority, feedback, google, scenes"]
            pipeline["pipeline.js<br/>COLMAP + Brush pipeline"]
            support["library.js (sync to VM), cleanup.js, catalog.js,<br/>metrics.js, scan.js, status.js, schemas.js, ratelimit.js"]
        end
        subgraph data["Data layer"]
            dbjs["db.js / dbstore.js<br/>the only files with SQL"]
            migrations["migrations/ + migrate.js<br/>every table change"]
        end
        config["config.js<br/>settings from .env / environment"]
    end

    sqlite[("data/app.db<br/>SQLite")]
    jobs[("jobs/<br/>photos, models, status.json")]
    files[("catalog/, sample-data/, schemas/<br/>reference data, sample jobs, formats")]
    vm["VM's shared library<br/>(team machines)"]
    tools["COLMAP, Brush,<br/>tools/*.py"]

    web -- "HTTP + JSON" --> routes
    engine -- "HTTP + JSON" --> routes
    curl -- "HTTP + JSON" --> routes
    server --> routes
    server --> middleware
    routes --> middleware
    routes --> versions
    routes --> sources
    routes --> services
    routes --> dbjs
    sources --> support
    sources --> vm
    sources --> files
    services --> pipeline
    services --> support
    services --> dbjs
    support --> files
    pipeline --> tools
    pipeline --> jobs
    support --> dbjs
    migrations --> sqlite
    dbjs --> sqlite
    config -.-> backend
```

| Layer | Where | Responsibility | Never does |
|---|---|---|---|
| Presentation | `packages/src/web-app/` | Screens, 3D viewing, user input. Calls the versioned API with relative URLs (`/api/v1/jobs`, `/api/v1/auth/login`, ...). | Database access, holding secrets. |
| API | `backend/routes/`, `backend/middleware/` | Reads requests, checks sign-in and access, validates input, replies with JSON or file data. | SQL, HTML pages. |
| Adapters | `backend/adapters/` | `apiVersions.js` turns the one internal shape into each API version's shape. `jobSources/` has one adapter per place jobs come from (job folders, the VM's library, sample data), each converting into the common JobSummary; `JOB_SOURCES` picks them. | Business rules, SQL. |
| Business logic | `backend/services/`, `pipeline.js`, `library.js`, `cleanup.js`, `catalog.js`, `metrics.js`, `scan.js`, `status.js`, `schemas.js`, `ratelimit.js` | Account rules, job life cycle, the COLMAP / Brush pipeline, sync to the VM, clean-up, the scene format, reading and checking the data files. `services/` never sees `req` / `res`. | HTTP replies, SQL. |
| Data | `backend/db.js`, `backend/dbstore.js`, `backend/migrations/` + `migrate.js` | Every SQL statement and every table change: users, sessions, job ownership, stored photos and models, feedback, scenes. | HTTP, UI. |
| Data files | `backend/catalog/`, `backend/sample-data/`, `backend/schemas/` | Reference data (feedback categories, training presets), sample jobs, and the JSON Schema of every format the backend saves or sends. | Code. |
| Configuration | `backend/config.js`, `backend/.env` (from `.env.example`) | Every server address, port, key and feature flag, read from environment variables. | Hard-coded secrets or server addresses. |

## Machines

```mermaid
flowchart LR
    browser1["Browser"] -->|"HTTP"| client["Team machine with a GPU<br/>AUTH_MODE=client<br/>builds models"]
    browser2["Browser"] -->|"HTTPS"| vm["VM<br/>AUTH_MODE=authority<br/>accounts, shared library"]
    client -->|"signup / login: /register, /verify-account<br/>finished jobs: PUT /library/jobs/:id<br/>shared key: X-Auth-Key"| vm
```

- **VM (`AUTH_MODE=authority`):**
  - holds every account and the shared library of finished models (with `FILE_STORE=db`, inside SQLite);
  - serves `/register`, `/verify-account` and `/library/...` to the team machines, which must send the shared `AUTH_API_KEY`;
  - Google sign-in runs here.
- **Team machines (`AUTH_MODE=client`):**
  - build models on their GPU;
  - pass sign-ups and logins to the VM (`VM_AUTH_URL`) and send each finished job there.
- **`AUTH_MODE=local` (default):**
  - one machine on its own, with its own accounts.

## Endpoints

Every path below is served under **`/api/v1`** (for example
`/api/v1/auth/login`), and also at the same path without the prefix (legacy,
unchanged for older clients). v1 sends every date as UTC epoch
milliseconds; the legacy paths keep ISO text for users, the account and
feedback ([api-changelog.md](api-changelog.md)).

All replies are JSON unless the table says otherwise. "User" means signed in
(the `genesis_session` cookie). "Owner" means the job's owner or an admin;
someone else's job answers 404. Every `/library/...` route is VM-only and
needs the shared key.

### Accounts

| Method | Path | Who | Reply |
|---|---|---|---|
| POST | `/auth/signup` | anyone | 201 user + session cookie; 400 / 409 / 429 |
| POST | `/auth/login` | anyone | 200 user + session cookie; 401 / 429 |
| GET | `/auth/me` | user | 200 user; 401 |
| POST | `/auth/logout` | anyone | 204 |
| GET | `/auth/me/account` | user | 200 account details |
| PATCH | `/auth/me` | user | 200 account details (new name) |
| POST | `/auth/me/password` | user | 200 account details; other sessions signed out |
| GET / PUT / DELETE | `/auth/me/avatar` | user | GET: the image (JPEG / PNG); PUT / DELETE: account details |
| GET | `/auth/me/storage` | user | 200 `{ usedBytes, models, jobs }` |
| GET | `/auth/google` | anyone | 302 to Google (VM), or to the VM's `/auth/google` |
| GET | `/auth/google/callback` | Google's redirect | 302 to `/` (signed in) or `/?login=...` |
| POST | `/register`, `/verify-account` | team machines (shared key) | create an account / check a password |

### Jobs (models and their photos)

| Method | Path | Who | Reply |
|---|---|---|---|
| POST | `/upload` | user | 202 `{ id, imageCount }`. Multipart `images` (8+ JPEG / PNG), optional `trainIters`, `removeBackground` |
| POST | `/jobs/from-media` | user | 202 `{ id }`. Multipart `media` (videos / GIFs), optional `fps`, `maxFrames`, `trainIters`, `removeBackground` |
| GET | `/jobs` | user | 200 JobSummary list of the user's jobs (admins: all), from the sources in `JOB_SOURCES` |
| GET | `/jobs/:id` | owner | 200 status, phase, progress, log tail |
| PATCH | `/jobs/:id` | owner | 200 `{ id, name, sampleFile }` (rename) |
| DELETE | `/jobs/:id` | owner | 200 cancelled; 409 if already finished |
| DELETE | `/jobs/:id/files` | owner | 200 `{ id, deleted: true }` |
| GET | `/jobs/:id/images/:name` | owner | the photo (binary) |
| GET / HEAD | `/jobs/:id/result.ply` | owner | the model (binary, byte ranges supported) |
| GET | `/jobs/:id/cover.webp` | owner | the card cover (binary); 404 if none |
| PUT | `/library/jobs/:id` | team machines (shared key) | 201 `{ id, bytes }`. Stores a finished job on the VM |

### Feedback

| Method | Path | Who | Reply |
|---|---|---|---|
| POST | `/feedback` | user | 201 `{ id }`. Body `{ category, message }`; category is a catalog id (`bug`, `idea`, `other`) |
| GET | `/feedback` | admin | 200 `{ items, hasMore }`. Query `category`, `before` |

### Scenes and reference data

| Method | Path | Who | Reply |
|---|---|---|---|
| GET | `/scenes` | user | 200 `[{ id, name, updatedAt, objectCount }]`, the user's scenes, newest first |
| POST | `/scenes` | user | 201 the scene as saved. Body: a scene of any format version (older ones are converted) |
| GET | `/scenes/:id` | user (own scenes) | 200 the scene exactly as saved; 404 |
| PUT | `/scenes/:id` | user (own scenes) | 200 the scene as saved; creates it under that id if new; 400 invalid, 422 newer format |
| DELETE | `/scenes/:id` | user (own scenes) | 204; 404 |
| GET | `/catalog` | anyone | 200 feedback categories, training presets, photo minimum and upload limits |

Any other path answers 404 with a JSON `{ error }`.

## Configuration and secrets

- Every setting comes from environment variables, usually set in
  `packages/src/backend/.env`. Copy
  [`.env.example`](../packages/src/backend/.env.example), which lists every
  variable with its default.
  - `.env` (and a dot-less `env`) is gitignored.
  - The shared key, the VM's address and the Google client secret are never
    written in the code or committed.
- The web app has no server addresses in it: it uses relative URLs. In
  development, Vite forwards them to the backend's port (`vite.config.js`).
- The engine's sign-in dialog asks for the server address. It defaults to
  this machine's backend and is saved in the engine's settings.

## Testing the API on its own

- **Automated tests:** `npm test` (in `packages/`) runs the backend tests in
  `packages/src/backend/tests/`. CI runs them on every push
  (`.github/workflows/ci.yml`). Each one starts real servers on temporary
  data and covers:
  - authentication: every protected endpoint answers 401 without a session,
    passwords and session tokens are stored only as hashes, and the shared
    key guards the VM routes;
  - the OpenAPI contract: the document matches the routes, the examples
    match the schemas, and real replies match the document;
  - no secrets in the repository;
  - migrations, saved scenes, API versions and data adapters.
- **By hand, against a running server:** `packages/api-tests/api-smoke.sh`
  (or `api-smoke.bat` on Windows) signs in and calls the endpoints with curl,
  checking each status code. See [its README](../packages/api-tests/README.md).
