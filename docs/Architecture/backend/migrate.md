# `backend/migrate.js` and `backend/migrations/`

*Author: Gabriel.* **Database migrations.** Each change to the database's tables is a numbered file in `migrations/`, applied once and in order. The database records the last migration applied in **`PRAGMA user_version`**, so every database (a new one, a teammate's, the VM's) ends up with the same tables. `db.js` runs migrations at startup, and they can also be run by hand (`npm run migrate`). A migration is either a `.sql` file (run as is) or a `.js` module exporting `up(db)`, a `description` and, for table rebuilds, `foreignKeysOff = true`. **Never edit a migration that has been committed; add a new one.**

## `migrate.js`

### `MIGRATIONS_DIR`, `MIGRATION_FILE_RE = /^(\d{3})_[\w-]+\.(js|sql)$/`

### `loadMigrations(dir)` *(exported, async)*
Reads and sorts the matching files. The numbering must be `001, 002, …` with **no gaps or repeats**, otherwise it throws. For a `.sql` file the description is its first `-- comment`. A `.js` file is imported dynamically and must export `up`.

### `countForeignKeyProblems(db)` *(private)*
The number of rows reported by `PRAGMA foreign_key_check`.

### `runMigrations(db, { backup, log, dir })` *(exported, async)*
1. If `user_version` is **newer than this build knows**, it throws (*"Update the code first."*).
2. If nothing is pending, it returns `[]`.
3. If the database already has tables, it calls `backup()` once and logs the path.
4. For each pending migration:
   - If `foreignKeysOff` is set, it turns foreign keys off **around** the transaction (they cannot be changed inside one) and counts the existing foreign-key problems first.
   - `BEGIN`, then `up(db)`. For rebuilds it checks that **no new** foreign-key problems appeared (rows that would lose their parent); problems that were already there do not stop it.
   - Sets `PRAGMA user_version = N` **inside the same transaction**, so the version only moves if the migration succeeded, then `COMMIT`.
   - On failure it rolls back and throws `"migration X failed: …"`, leaving the database at the last good version.
   - Turns foreign keys back on if they were on before.
5. Returns `[{ version, file, description }]` for the migrations applied.

### `main()` (command line)
`node migrate.js [--db <file>] [--status]`. The default file is `<DATA_DIR>/app.db`. It prints `version X of N`. With `--status` it lists the pending migrations; otherwise it migrates, using a `VACUUM INTO <file>.bak-<time>` backup, and prints the result. Exits with code 1 on failure. It only runs when the file is executed directly.

## Migrations

| File | Change |
|---|---|
| `001_baseline.js` | The schema as it was before migrations existed. It works on a clean database **and** on any `app.db` from an older build: tables are created only if missing, and later columns (`role`, `google_sub`, `password_changed_at`, `origin`, `bytes`) are added only if missing, through `addColumnIfMissing(db, table, column, def)` (which reads `PRAGMA table_info`). Tables: `users` (email `UNIQUE COLLATE NOCASE`, role `user` or `admin`), `sessions` (token hash, user, expiry), `jobs` (id, owner, created, origin, bytes), `uploads`, `user_avatars`, `synced_jobs`, `job_images`, `job_models`, `job_model_chunks`, `feedback`. |
| `002_drop_uploads.sql` | Drops the unused `uploads` table. A job's photos are listed from its folder or from `job_images`. |
| `003_timestamps_ms.js` | `foreignKeysOff`. **Every date becomes UTC epoch milliseconds** (`INTEGER`), the one date format used across the database, the API and saved files. SQLite cannot change a column's type, so `users`, `jobs`, `feedback` and `synced_jobs` are rebuilt the documented way (new table, copy, drop, rename). `toMs(column)` keeps integers as they are, converts `datetime` text with `strftime('%s') * 1000`, and leaves NULL alone. `NOW_MS` is a default that works on every SQLite version. `feedback.category` loses its CHECK list, because the categories now live in `catalog.json`. |
| `004_scenes.sql` | Adds `scenes(id, owner_id → users ON DELETE CASCADE, name, format_version, document JSON, created_at, updated_at)` with an index on `(owner_id, updated_at)`. |
| `005_performance.sql` | Adds `perf_minutes(kind, name, minute, count, errors, sum_ms, max_ms, buckets JSON)` with primary key `(kind, name, minute)` and an index on `minute`. |
| `006_password_resets.sql` | Adds `password_resets(user_id PK → users CASCADE, code_hash, expires_at, attempts, created_at)`: at most one code per account, stored as a scrypt hash. |
