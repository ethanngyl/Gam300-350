# `backend/catalog.js`, `schemas.js`, `ratelimit.js`

Three small support modules, all by Gabriel.

---

## `catalog.js`
The website's reference data (feedback categories, training presets, the minimum photo count) lives in `catalog/catalog.json` (format `schemas/catalog.schema.json`), not in code. This file reads and checks it **once at startup**. A broken catalog stops the backend with a message that names every problem. `CATALOG_FILE` can point at another copy.

### `loadCatalog(file)` *(private)*
Parses the JSON (a read error is rethrown with the file name), validates it against the `catalog` schema, then checks the rules a schema cannot express:
- category ids and preset ids are unique;
- `defaultTrainingPreset` is one of the presets;
- every preset's `iterations` is within `config.minTrainIters`–`maxTrainIters`;
- `feedbackMessage.minLength` is not greater than `maxLength`.

It throws one error listing all the problems, and otherwise returns the catalog `deepFreeze`d.

### `deepFreeze(value)` *(private)*
Freezes the object and everything inside it, so no code can change the reference data by accident.

### `export const catalog`
The checked, frozen catalog.

### `catalogForApi()` *(exported)*
What `GET /api/v1/catalog` returns: the catalog plus `limits: { maxPhotos, maxPhotoSizeMB, maxMediaFiles, maxMediaSizeMB, maxFrameFps, minTrainIters, maxTrainIters, maxAvatarKB }` from config. A client therefore needs no copies of either.

---

## `schemas.js`
Checks data against the **JSON Schema (draft-07)** files in `schemas/` using **Ajv** (`allErrors: true`). These files are the published formats (`docs/data-schema.md`): `catalog`, `job-summary`, `job-status`, `sample-jobs` and `scene.v1`. Checking against the same files the docs point to keeps the two from drifting apart.

- **`SCHEMAS_DIR`**: the `backend/schemas` folder.
- **`validate(schemaName, data)`**: returns one readable line per problem (`"/objects/0/position must NOT have fewer than 3 items"`, or `(top level) …`). An empty list means the data is valid.
- **`schemaErrors(schemaName, data)`**: the same check, returning Ajv's error objects (with `instancePath`), for callers that need to know which field failed. Each schema is read and compiled **once** and cached in a `Map`.

---

## `ratelimit.js`
A small **in-memory, fixed-window** rate limiter. It slows down password guessing and signup spam, limits the builds and model downloads each user can start, and caps API requests per user or address (see [middleware/limits](middleware/limits.md)). The counters live in this process only and reset on restart. That is acceptable here, because one VM holds the accounts, and it needs no extra package or database table.

### `createLimiter({ windowMs, max })`
- **`max <= 0` switches the limiter off**: every call is allowed and no sweep timer is started. This is how a `RATE_LIMIT_*` setting of 0 turns a limit off.
- Otherwise `entries: Map<key, { count, resetAt }>`. A key's window **starts at its first event**.
- A `setInterval` (run every `windowMs`, and `unref`ed so it never keeps the process alive) deletes expired windows, so the map cannot grow forever.
- Returns:
  - **`hit(key)`**: starts or continues the window, increments the count, and returns `{ allowed: count <= max, retryAfterSec }`.
  - **`check(key)`**: the same answer without counting (the key is not allowed once it has reached `max`).
  - **`reset(key)`**: deletes the key, for example after a successful login.
- The private helpers `current(key)` (an expired entry is deleted and returns `null`) and `result(entry)` support these.
