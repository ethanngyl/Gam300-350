/*!************************************************************************
\file migrations.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Database migrations (migrations/ + migrate.js): a clean database, a
database made before migrations existed (text dates), running twice, a
database newer than the code, a failing migration rolling back, and a gap
in the numbering.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { BACKEND_DIR, isolatedEnv, tempDir } from './helpers.js'

// migrate.js reads config.js, which would load a developer's .env.
const scratch = tempDir('migrations')
process.env.ENV_FILE = path.join(scratch, 'no-such.env')
const { MIGRATIONS_DIR, loadMigrations, runMigrations } = await import('../migrate.js')

const NEWEST = (await loadMigrations()).length
const cli = (file) => spawnSync(process.execPath, [path.join(BACKEND_DIR, 'migrate.js'), '--db', file], { env: isolatedEnv(scratch), encoding: 'utf8' })
const tables = (db) => db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((r) => r.name)
const columnType = (db, table, column) => db.prepare(`PRAGMA table_info(${table})`).all().find((c) => c.name === column)?.type
const version = (db) => db.prepare('PRAGMA user_version').get().user_version

// The schema db.js built for itself before migrations existed (user_version 0).
const PRE_MIGRATION_SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')), google_sub TEXT, password_changed_at TEXT);
  CREATE UNIQUE INDEX idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE TABLE jobs (id TEXT PRIMARY KEY, owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), origin TEXT, bytes INTEGER);
  CREATE TABLE uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, original_name TEXT, stored_name TEXT,
    mime_type TEXT, size INTEGER, uploaded_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE user_avatars (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, mime TEXT NOT NULL, data BLOB NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE synced_jobs (id TEXT PRIMARY KEY, synced_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE job_images (job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, name TEXT NOT NULL, mime TEXT NOT NULL,
    size INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (job_id, name));
  CREATE TABLE job_models (job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE, size INTEGER NOT NULL, chunk_size INTEGER NOT NULL, stored_at INTEGER NOT NULL);
  CREATE TABLE job_model_chunks (job_id TEXT NOT NULL REFERENCES job_models(job_id) ON DELETE CASCADE, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (job_id, seq));
  CREATE TABLE feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, user_email TEXT NOT NULL,
    user_name TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('bug', 'idea', 'other')), message TEXT NOT NULL, origin TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
`

// ----- Tests --------------------------------------------------------- //

test('a clean database is built by the command line, and a second run does nothing', () =>
{
  const file = path.join(scratch, 'clean.db')
  let run = cli(file)
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, new RegExp(`now at version ${NEWEST}`))
  const db = new DatabaseSync(file)
  assert.equal(version(db), NEWEST)
  assert.deepEqual(tables(db), ['feedback', 'job_images', 'job_model_chunks', 'job_models', 'jobs', 'scenes', 'sessions', 'synced_jobs', 'user_avatars', 'users'])
  for (const [table, column] of [['users', 'created_at'], ['users', 'password_changed_at'], ['jobs', 'created_at'], ['feedback', 'created_at'], ['synced_jobs', 'synced_at'], ['scenes', 'updated_at']])
    assert.equal(columnType(db, table, column), 'INTEGER', `${table}.${column}`)
  db.exec(`INSERT INTO users (email, name, password_hash) VALUES ('a@example.com', 'A', 'x:y')`)
  assert.ok(Math.abs(db.prepare('SELECT created_at FROM users').get().created_at - Date.now()) < 5000, 'default date is now, in ms')
  db.close()
  run = cli(file)
  assert.equal(run.status, 0)
  assert.match(run.stdout, /already up to date/)
})

test('a database from before migrations is upgraded, keeping its data', async () =>
{
  const file = path.join(scratch, 'old.db')
  let db = new DatabaseSync(file)
  db.exec(PRE_MIGRATION_SCHEMA)
  db.exec(`
    INSERT INTO users (id, email, name, password_hash, created_at, google_sub, password_changed_at)
      VALUES (1, 'old@example.com', 'Old', 'aa:bb', '2026-10-04 08:15:00', 'google-1', '2026-10-20 10:00:00');
    INSERT INTO sessions VALUES ('hash-1', 1, ${Date.now() + 60000});
    INSERT INTO jobs (id, owner_id, created_at, origin, bytes) VALUES ('job-1', 1, '2026-10-06 12:00:00', 'pc-1', 1234);
    INSERT INTO synced_jobs VALUES ('job-1', '2026-10-07 00:00:01');
    INSERT INTO feedback (user_id, user_email, user_name, category, message, created_at) VALUES (1, 'old@example.com', 'Old', 'idea', 'An old idea', '2026-10-05 01:02:03');
    INSERT INTO user_avatars VALUES (1, 'image/png', x'89504e47', 5);
    INSERT INTO uploads (job_id) VALUES ('job-1');
  `)
  db.close()

  const backups = []
  db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  const applied = await runMigrations(db, { backup: () => { backups.push('made'); return 'backup' } })
  assert.equal(applied.length, NEWEST)
  assert.equal(backups.length, 1, 'backed up first')
  assert.equal(version(db), NEWEST)
  assert.deepEqual({ ...db.prepare('SELECT created_at, password_changed_at, google_sub FROM users').get() },
    { created_at: Date.UTC(2026, 9, 4, 8, 15, 0), password_changed_at: Date.UTC(2026, 9, 20, 10, 0, 0), google_sub: 'google-1' })
  assert.deepEqual({ ...db.prepare('SELECT owner_id, created_at, origin, bytes FROM jobs').get() }, { owner_id: 1, created_at: Date.UTC(2026, 9, 6, 12, 0, 0), origin: 'pc-1', bytes: 1234 })
  assert.equal(db.prepare('SELECT synced_at FROM synced_jobs').get().synced_at, Date.UTC(2026, 9, 7, 0, 0, 1))
  assert.equal(db.prepare('SELECT created_at FROM feedback').get().created_at, Date.UTC(2026, 9, 5, 1, 2, 3))
  assert.ok(!tables(db).includes('uploads'), 'unused table dropped')
  assert.ok(db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'idx_users_google_sub'`).get(), 'index kept')
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  db.exec('DELETE FROM users WHERE id = 1')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0, 'foreign keys still cascade after the rebuild')
  assert.equal(db.prepare('SELECT owner_id FROM jobs').get().owner_id, null)
  db.close()
})

test('a database newer than the code is refused', () =>
{
  const file = path.join(scratch, 'newer.db')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA user_version = 99')
  db.close()
  const run = cli(file)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /newer than this build/)
})

test('a failing migration rolls back and leaves the version alone', async () =>
{
  const dir = path.join(scratch, 'broken-migrations')
  fs.cpSync(MIGRATIONS_DIR, dir, { recursive: true })
  const next = String(NEWEST + 1).padStart(3, '0')
  fs.writeFileSync(path.join(dir, `${next}_broken.sql`), '-- broken on purpose\nCREATE TABLE half_done (x);\nSELECT * FROM no_such_table;\n')
  const db = new DatabaseSync(':memory:')
  await assert.rejects(runMigrations(db, { dir }), new RegExp(`${next}_broken\\.sql failed`))
  assert.equal(version(db), NEWEST)
  assert.ok(!tables(db).includes('half_done'))
  db.close()
})

test('a gap in the numbering is refused', async () =>
{
  const dir = path.join(scratch, 'gap-migrations')
  fs.cpSync(MIGRATIONS_DIR, dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${String(NEWEST + 2).padStart(3, '0')}_gap.sql`), 'SELECT 1;')
  await assert.rejects(loadMigrations(dir), /no gaps or repeats/)
})
