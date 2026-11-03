/*!************************************************************************
\file 003_timestamps_ms.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Migration 3: every date in the database becomes UTC epoch milliseconds
(INTEGER), the one date format used across the database, the API and saved
files (docs/data-schema.md). users.created_at / password_changed_at,
jobs.created_at, feedback.created_at and synced_jobs.synced_at were
SQLite datetime('now') text ("2026-10-04 08:15:00", UTC); sessions,
user_avatars and job_models already used milliseconds.
SQLite can't change a column's type, so each table is rebuilt the way the
SQLite documentation describes (new table, copy, drop, rename) with foreign
keys off; the runner checks no foreign key broke. feedback.category loses
its CHECK list: the categories are reference data in catalog/catalog.json,
which the API checks against.
**************************************************************************/

export const description = 'store every date as UTC epoch milliseconds'
// Table rebuilds: the runner turns foreign keys off around this migration.
export const foreignKeysOff = true

// The current time in milliseconds, for column defaults (works on every
// SQLite version, unlike unixepoch('subsec')).
const NOW_MS = `(CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER))`

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    SQL turning an old date column into milliseconds: datetime text is UTC,
    a value that is already a number is kept, NULL stays NULL.
  \param column
    string
  \return
    SQL expression
*/
/************************************************************************/
function toMs(column)
{
  return `CASE WHEN ${column} IS NULL THEN NULL
               WHEN typeof(${column}) = 'integer' THEN ${column}
               ELSE CAST(strftime('%s', ${column}) AS INTEGER) * 1000 END`
}

/************************************************************************/
/*!
  \brief
    Rebuilds the four tables with INTEGER millisecond dates.
  \param db
    DatabaseSync, inside the runner's transaction (foreign keys off)
*/
/************************************************************************/
export function up(db)
{
  db.exec(`
    CREATE TABLE users_new (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name                TEXT NOT NULL,
      password_hash       TEXT NOT NULL,
      role                TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at          INTEGER NOT NULL DEFAULT ${NOW_MS},
      google_sub          TEXT,
      password_changed_at INTEGER
    );
    INSERT INTO users_new (id, email, name, password_hash, role, created_at, google_sub, password_changed_at)
      SELECT id, email, name, password_hash, role, COALESCE(${toMs('created_at')}, ${NOW_MS}), google_sub,
             ${toMs('password_changed_at')}
      FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;

    CREATE TABLE jobs_new (
      id         TEXT PRIMARY KEY,
      owner_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT ${NOW_MS},
      origin     TEXT,
      bytes      INTEGER
    );
    INSERT INTO jobs_new (id, owner_id, created_at, origin, bytes)
      SELECT id, owner_id, COALESCE(${toMs('created_at')}, ${NOW_MS}), origin, bytes FROM jobs;
    DROP TABLE jobs;
    ALTER TABLE jobs_new RENAME TO jobs;

    CREATE TABLE feedback_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_email TEXT NOT NULL,
      user_name  TEXT NOT NULL,
      category   TEXT NOT NULL,
      message    TEXT NOT NULL,
      origin     TEXT,
      created_at INTEGER NOT NULL DEFAULT ${NOW_MS}
    );
    INSERT INTO feedback_new (id, user_id, user_email, user_name, category, message, origin, created_at)
      SELECT id, user_id, user_email, user_name, category, message, origin, COALESCE(${toMs('created_at')}, ${NOW_MS})
      FROM feedback;
    DROP TABLE feedback;
    ALTER TABLE feedback_new RENAME TO feedback;

    CREATE TABLE synced_jobs_new (
      id        TEXT PRIMARY KEY,
      synced_at INTEGER NOT NULL DEFAULT ${NOW_MS}
    );
    INSERT INTO synced_jobs_new (id, synced_at)
      SELECT id, COALESCE(${toMs('synced_at')}, ${NOW_MS}) FROM synced_jobs;
    DROP TABLE synced_jobs;
    ALTER TABLE synced_jobs_new RENAME TO synced_jobs;
  `)
}
// ----- End of Functions ----------------------------------------------------- //
