/*!************************************************************************
\file db.js
\author1 Gabriel Sebastian Putra
\par DP email1: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 13-10-2026
\brief
This source file owns the SQLite database (node:sqlite, built into Node)
that stores user accounts, login sessions and who owns each job. The file
lives at data/app.db next to this file and is created on first run.
Passwords are never stored: only a salted scrypt hash. Session tokens are
never stored either: only their SHA-256, so a copied database can't be used
to log in.
Tables:
  users    -- accounts. role is 'user' (default) or 'admin'. Signup never
              sets the role; promote an admin by editing the database:
              UPDATE users SET role = 'admin' WHERE email = '...'
  sessions -- one row per logged-in browser (token hash, user, expiry)
  jobs     -- which user created each job folder under jobs/. Jobs with no
              row (made before accounts existed) are visible to admins only.
- hashPassword(password)
Returns "salt:hash" (hex) using a random 16-byte salt and scrypt.
- verifyPassword(password, stored)
Recomputes the hash with the stored salt and compares in constant time.
- createUser({ email, name, password })
Inserts a new user. Throws an error with code 'EMAIL_TAKEN' if the email is
already registered.
- findUserByEmail(email)
Returns the user row (including password_hash) or null. Email matching is
case-insensitive.
- createSession(userId, ttlMs)
Starts a session lasting ttlMs (7 days by default) and returns the raw
token to put in the cookie.
- findSessionUser(token)
Returns the logged-in user for a cookie token, or null if unknown/expired.
- deleteSession(token)
Logs that session out.
- setJobOwner(jobId, userId)
Records who created a job.
- getJobOwnerId(jobId)
Returns the owner's user id, or null if the job has no owner.
- listOwnedJobIds(userId)
Returns a Set of the job ids that user created.
- upsertLocalUser({ id, email, name, role })
On a 'client' machine: copies a user the VM vouched for into this machine's
users table under the VM's id (no password stored).
- retireLocalAccounts()
On a 'client' machine: backs up the database, then removes accounts made on
this machine so they can't clash with the VM's. Their uploads become
admin-only.
- findOrCreateGoogleUser({ sub, email, name })
On the VM: the account for a Google sign-in (see its comment for linking).
- findUserById(id)
Looks up a user by id (the VM acting as a user a client machine names).
- recordStoredJob(jobId, ownerId, origin, bytes)
On the VM: records a job received from a client machine for the shared
library (owner, origin machine, size). Stored in the jobs table's origin and
bytes columns.
- markJobSynced / unmarkJobSynced / isJobSynced(jobId)
On a client machine: which finished jobs the VM already has (table
synced_jobs), so each is sent once.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const scrypt = promisify(crypto.scrypt)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')

// How long a "Remember me" login lasts before the user has to sign in again.
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Server-side limit for a login without "Remember me". Its cookie already
// ends when the browser closes; this also ends it if the browser stays open
// (or restores the cookie on restart).
export const SHORT_SESSION_TTL_MS = 24 * 60 * 60 * 1000

// DatabaseSync can't create the folder, only the file.
fs.mkdirSync(DATA_DIR, { recursive: true })

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'))

// SQLite ignores REFERENCES / ON DELETE unless this is on (per connection).
db.exec('PRAGMA foreign_keys = ON')

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

// Databases made before roles existed have a users table without the role
// column; CREATE TABLE IF NOT EXISTS won't add it, so add it here.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((col) => col.name)
if (!userColumns.includes('role'))
{
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))`)
}

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

// Expired sessions are useless; clear them out once per startup.
db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())

const insertUser = db.prepare(
  'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) RETURNING id, email, name, role, created_at'
)
const selectUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?')

const insertSession = db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
const selectSessionUser = db.prepare(`
  SELECT u.id, u.email, u.name, u.role, u.created_at
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ? AND s.expires_at > ?
`)
const removeSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?')

const upsertJobOwner = db.prepare(
  'INSERT INTO jobs (id, owner_id) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id'
)
const selectJobOwner = db.prepare('SELECT owner_id FROM jobs WHERE id = ?')
const selectOwnedJobIds = db.prepare('SELECT id FROM jobs WHERE owner_id = ?')

// Upsert a user the authority (VM) vouched for. The VM's id is authoritative,
// so we insert/replace by that id. No password is stored locally — the VM
// holds the only password hash. password_hash is NOT NULL in the schema, so a
// fixed non-hash placeholder is stored; verifyPassword is never called on a
// mirrored row (login goes through the VM), and its "salt:hash" split would
// fail safely anyway.
const upsertMirroredUser = db.prepare(`
  INSERT INTO users (id, email, name, password_hash, role)
  VALUES (?, ?, ?, 'remote', ?)
  ON CONFLICT(id) DO UPDATE SET
    email = excluded.email,
    name  = excluded.name,
    role  = excluded.role
`)
// A different row holding the same email would break the UNIQUE email rule
// when mirroring; it can only be a stale copy, so it is removed first.
const deleteOtherUserWithEmail = db.prepare('DELETE FROM users WHERE email = ? AND id != ?')

// Accounts created on this machine (not mirrored from the VM).
const countLocalAccounts = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE password_hash != 'remote'`)
const deleteLocalAccounts = db.prepare(`DELETE FROM users WHERE password_hash != 'remote'`)

// Google accounts have no password; they're matched by Google's stable user
// id (the ID token's "sub"). Add the column to databases made before SSO.
const hasGoogleSub = db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'google_sub')
if (!hasGoogleSub)
{
  db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT')
  // UNIQUE so two rows can't claim the same Google identity. A partial index
  // lets the many password users keep google_sub = NULL without clashing.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL')
}

const selectUserByGoogleSub = db.prepare('SELECT * FROM users WHERE google_sub = ?')
const insertGoogleUser = db.prepare(
  `INSERT INTO users (email, name, password_hash, google_sub)
   VALUES (?, ?, 'google-sso', ?) RETURNING id, email, name, role, created_at`
)
// Linking also cancels the account's password: signup never proves email
// ownership, so a password set before the real owner arrived may not be theirs.
const linkGoogleToUser = db.prepare(`UPDATE users SET google_sub = ?, password_hash = 'google-sso' WHERE id = ?`)
const deleteSessionsForUser = db.prepare('DELETE FROM sessions WHERE user_id = ?')

const selectUserById = db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?')

// Shared library: on the VM, where each stored job came from and how much
// disk it takes. Added to databases made before the library existed.
const jobColumns = db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name)
if (!jobColumns.includes('origin')) db.exec('ALTER TABLE jobs ADD COLUMN origin TEXT')
if (!jobColumns.includes('bytes')) db.exec('ALTER TABLE jobs ADD COLUMN bytes INTEGER')

// On a client machine: which finished jobs the VM has already received, so
// each is sent once. Not a column on jobs: old jobs may have no jobs row.
db.exec(`
  CREATE TABLE IF NOT EXISTS synced_jobs (
    id        TEXT PRIMARY KEY,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)

const upsertStoredJob = db.prepare(`
  INSERT INTO jobs (id, owner_id, origin, bytes) VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    owner_id = excluded.owner_id,
    origin   = excluded.origin,
    bytes    = excluded.bytes
`)
const insertSyncedJob = db.prepare('INSERT OR REPLACE INTO synced_jobs (id) VALUES (?)')
const deleteSyncedJob = db.prepare('DELETE FROM synced_jobs WHERE id = ?')
const selectSyncedJob = db.prepare('SELECT 1 FROM synced_jobs WHERE id = ?')


// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Hashes a password with a fresh random salt.
  \param password
  string
    The plaintext password
  \return
    "salt:hash" as hex
*/
/************************************************************************/
export async function hashPassword(password)
{
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

/************************************************************************/
/*!
  \brief
    Checks a password against a stored "salt:hash" in constant time.
  \param password
  string
    The plaintext password to check
  \param stored
  string
    The password_hash column value
  \return
    true if the password matches
*/
/************************************************************************/
export async function verifyPassword(password, stored)
{
  const [saltHex, hashHex] = String(stored).split(':')
  if (!saltHex || !hashHex) return false

  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
  return crypto.timingSafeEqual(actual, expected)
}

/************************************************************************/
/*!
  \brief
    Creates a user account with a hashed password. New accounts are always
    role 'user'.
  \param user
    { email, name, password }
  \return
    { id, email, name, role, createdAt }. Throws (code 'EMAIL_TAKEN') if
    the email is already registered.
*/
/************************************************************************/
export async function createUser({ email, name, password })
{
  const passwordHash = await hashPassword(password)
  try
  {
    const row = insertUser.get(email, name, passwordHash)
    return { id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at }
  }
  catch (err)
  {
    if (/UNIQUE constraint failed/.test(err.message))
    {
      const taken = new Error('Email already registered')
      taken.code = 'EMAIL_TAKEN'
      throw taken
    }
    throw err
  }
}

/************************************************************************/
/*!
  \brief
    Looks up a user by email (case-insensitive).
  \param email
  string
    The email to look up
  \return
    The user row (including password_hash), or null
*/
/************************************************************************/
export function findUserByEmail(email)
{
  return selectUserByEmail.get(email) ?? null
}

/************************************************************************/
/*!
  \brief
    SHA-256 of a session token. Only the hash is stored, so reading the
    database doesn't hand out working logins.
  \param token
  string
    The raw token from the cookie
  \return
    hex digest
*/
/************************************************************************/
function hashToken(token)
{
  return crypto.createHash('sha256').update(token).digest('hex')
}

/************************************************************************/
/*!
  \brief
    Starts a login session for a user.
  \param userId
  number
    The user's id
  \param ttlMs
  number
    How long the session stays valid, in milliseconds
  \return
    The raw session token (send it to the browser as a cookie)
*/
/************************************************************************/
export function createSession(userId, ttlMs = SESSION_TTL_MS)
{
  const token = crypto.randomBytes(32).toString('base64url')
  insertSession.run(hashToken(token), userId, Date.now() + ttlMs)
  return token
}

/************************************************************************/
/*!
  \brief
    Finds the user a session cookie belongs to.
  \param token
  string
    The raw token from the cookie
  \return
    { id, email, name, role, created_at }, or null if the token is
    unknown or expired
*/
/************************************************************************/
export function findSessionUser(token)
{
  if (!token) return null
  return selectSessionUser.get(hashToken(token), Date.now()) ?? null
}

/************************************************************************/
/*!
  \brief
    Ends a session (logout). Does nothing if it doesn't exist.
  \param token
  string
    The raw token from the cookie
*/
/************************************************************************/
export function deleteSession(token)
{
  if (token) removeSession.run(hashToken(token))
}

/************************************************************************/
/*!
  \brief
    Records which user created a job.
  \param jobId
  string
    The job's id (its folder name under jobs/)
  \param userId
  number
    The owner's user id
*/
/************************************************************************/
export function setJobOwner(jobId, userId)
{
  upsertJobOwner.run(jobId, userId)
}

/************************************************************************/
/*!
  \brief
    Looks up who created a job.
  \param jobId
  string
    The job's id
  \return
    The owner's user id, or null if the job has no recorded owner
*/
/************************************************************************/
export function getJobOwnerId(jobId)
{
  return selectJobOwner.get(jobId)?.owner_id ?? null
}

/************************************************************************/
/*!
  \brief
    All job ids a user created.
  \param userId
  number
    The user's id
  \return
    Set of job id strings
*/
/************************************************************************/
export function listOwnedJobIds(userId)
{
  return new Set(selectOwnedJobIds.all(userId).map((row) => row.id))
}

/************************************************************************/
/*!
  \brief
    Mirror a user the VM authenticated into the local users table, so local
    sessions and job ownership (both reference users.id) work with the VM's
    canonical id. No password is stored locally.
  \param user
    { id, email, name, role } as returned by the VM
  \return
    nothing
*/
/************************************************************************/
export function upsertLocalUser({ id, email, name, role })
{
  // One transaction, so a failed save can't leave the old row deleted.
  db.exec('BEGIN')
  try
  {
    deleteOtherUserWithEmail.run(email, id)
    upsertMirroredUser.run(id, email, name, role === 'admin' ? 'admin' : 'user')
    db.exec('COMMIT')
  }
  catch (err)
  {
    db.exec('ROLLBACK')
    throw err
  }
}

/************************************************************************/
/*!
  \brief
    For a machine switching to 'client' mode: removes every account that
    was created on this machine (anything not mirrored from the VM), so
    their ids and emails can't clash with the VM's. Through the foreign
    keys their sessions are deleted and their uploads lose their owner,
    which makes those uploads admin-only. Backs up the database first.
    Does nothing (and makes no backup) when there are no local accounts.
  \return
    { removed, backupPath } -- backupPath is null when nothing was removed
*/
/************************************************************************/
export function retireLocalAccounts()
{
  const { n } = countLocalAccounts.get()
  if (n === 0) return { removed: 0, backupPath: null }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(DATA_DIR, `app.db.bak-${stamp}`)
  db.prepare('VACUUM INTO ?').run(backupPath)

  const { changes } = deleteLocalAccounts.run()
  return { removed: Number(changes), backupPath }
}

/************************************************************************/
/*!
  \brief
    Find-or-create the account for a Google sign-in, linking by email.
    Match order: (1) by Google sub (returning Google user); (2) by email
    (an existing password account -> attach this Google id to it); else
    (3) create a new Google account. password_hash is a sentinel: these
    accounts never log in by password.
    Linking (2) cancels the old password and logs out every existing
    session of that account. Signup doesn't prove email ownership, so
    someone else may have registered this email first ("pre-hijacking");
    after linking, only the verified Google owner can get in. An email row
    already linked to a different Google id is never moved.
  \param profile
    { sub, email, name } from Google's verified ID token
  \return
    { id, email, name, role, createdAt }, or null if the email belongs to
    an account linked to a different Google id
*/
/************************************************************************/
export function findOrCreateGoogleUser({ sub, email, name })
{
  const bySub = selectUserByGoogleSub.get(sub)
  if (bySub) return { id: bySub.id, email: bySub.email, name: bySub.name, role: bySub.role, createdAt: bySub.created_at }

  const byEmail = selectUserByEmail.get(email)
  if (byEmail)
  {
    if (byEmail.google_sub && byEmail.google_sub !== sub) return null

    // One transaction, so a password can't be cancelled without its
    // sessions going too (or the other way round).
    db.exec('BEGIN')
    try
    {
      linkGoogleToUser.run(sub, byEmail.id)   // link: same email = same account
      deleteSessionsForUser.run(byEmail.id)   // log out whoever was already in
      db.exec('COMMIT')
    }
    catch (err)
    {
      db.exec('ROLLBACK')
      throw err
    }
    return { id: byEmail.id, email: byEmail.email, name: byEmail.name, role: byEmail.role, createdAt: byEmail.created_at }
  }

  const row = insertGoogleUser.get(email, name || email, sub)
  return { id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at }
}

/************************************************************************/
/*!
  \brief
    Looks up a user by id. On the VM, used to act as the user a client
    machine names, with the role taken from the VM's own database.
  \param id
  number
    The user's id
  \return
    { id, email, name, role, created_at }, or null
*/
/************************************************************************/
export function findUserById(id)
{
  return selectUserById.get(id) ?? null
}

/************************************************************************/
/*!
  \brief
    On the VM: records a job received from a client machine -- its owner
    (null = admin-only), the machine it came from, and its size on disk.
    Sending the same job again overwrites the record.
  \param jobId
  string
  \param ownerId
  number | null
  \param origin
  string
    The sending machine's name
  \param bytes
  number
    Total size of the stored files
*/
/************************************************************************/
export function recordStoredJob(jobId, ownerId, origin, bytes)
{
  upsertStoredJob.run(jobId, ownerId, origin, bytes)
}

/************************************************************************/
/*!
  \brief
    On a client machine: marks a job as received by the VM / no longer
    there / asks whether it was received.
  \param jobId
  string
*/
/************************************************************************/
export function markJobSynced(jobId)
{
  insertSyncedJob.run(jobId)
}

export function unmarkJobSynced(jobId)
{
  deleteSyncedJob.run(jobId)
}

export function isJobSynced(jobId)
{
  return Boolean(selectSyncedJob.get(jobId))
}
// ----- End of Functions ----------------------------------------------------- //
