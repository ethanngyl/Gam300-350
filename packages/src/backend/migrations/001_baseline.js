/*!************************************************************************
\file 001_baseline.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Migration 1: the database as it was before migrations existed (the schema
db.js used to build itself). It works on a clean database and on any
app.db made by an older build: tables are only created when missing, and
columns added by later builds (role, google_sub, password_changed_at,
origin, bytes) are only added when missing.
**************************************************************************/

export const description = 'baseline schema (users, sessions, jobs, feedback, stored photos and models)'

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Adds a column to a table unless it is already there.
  \param db
    DatabaseSync
  \param table
    string
  \param column
    string
  \param definition
    string, the column's type and constraints
*/
/************************************************************************/
function addColumnIfMissing(db, table, column, definition)
{
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name)
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

/************************************************************************/
/*!
  \brief
    Builds (or completes) the baseline schema.
  \param db
    DatabaseSync, inside the runner's transaction
*/
/************************************************************************/
export function up(db)
{
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  // Databases made before roles existed have a users table without the role column.
  addColumnIfMissing(db, 'users', 'role', `TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))`)
  // Google accounts are matched by Google's stable user id (the ID token's "sub").
  addColumnIfMissing(db, 'users', 'google_sub', 'TEXT')
  // UNIQUE so two rows can't claim the same Google identity. A partial index
  // lets the many password users keep google_sub = NULL without clashing.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL')
  // Account page: when the password was last changed (NULL: never, since signup).
  addColumnIfMissing(db, 'users', 'password_changed_at', 'TEXT')

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id         TEXT PRIMARY KEY,
      owner_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  // Shared library: on the VM, where each stored job came from and its size.
  addColumnIfMissing(db, 'jobs', 'origin', 'TEXT')
  addColumnIfMissing(db, 'jobs', 'bytes', 'INTEGER')

  db.exec(`
    CREATE TABLE IF NOT EXISTS uploads (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id        TEXT NOT NULL,
      original_name TEXT,
      stored_name   TEXT,
      mime_type     TEXT,
      size          INTEGER,
      uploaded_at   TEXT DEFAULT (datetime('now'))
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_avatars (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      mime       TEXT NOT NULL,
      data       BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS synced_jobs (
      id        TEXT PRIMARY KEY,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS job_images (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      name   TEXT NOT NULL,
      mime   TEXT NOT NULL,
      size   INTEGER NOT NULL,
      data   BLOB NOT NULL,
      PRIMARY KEY (job_id, name)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS job_models (
      job_id     TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      size       INTEGER NOT NULL,
      chunk_size INTEGER NOT NULL,
      stored_at  INTEGER NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_model_chunks (
      job_id TEXT NOT NULL REFERENCES job_models(job_id) ON DELETE CASCADE,
      seq    INTEGER NOT NULL,
      data   BLOB NOT NULL,
      PRIMARY KEY (job_id, seq)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_email TEXT NOT NULL,
      user_name  TEXT NOT NULL,
      category   TEXT NOT NULL CHECK (category IN ('bug', 'idea', 'other')),
      message    TEXT NOT NULL,
      origin     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}
// ----- End of Functions ----------------------------------------------------- //
