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
lives at data/app.db next to this file (DATA_DIR can move the folder) and
is created on first run.
Passwords are never stored: only a salted scrypt hash. Session tokens are
never stored either: only their SHA-256, so a copied database can't be used
to log in.
The tables are created and changed only by the numbered migrations in
migrations/ (run by migrate.js at startup); docs/data-schema.md has the
diagram. This is the only file with SQL in it. Columns are snake_case;
everything returned is camelCase. Every date is UTC epoch milliseconds.
Tables:
  users    -- accounts. role is 'user' (default) or 'admin'. Signup never
              sets the role; promote an admin by editing the database:
              UPDATE users SET role = 'admin' WHERE email = '...'
  sessions -- one row per logged-in browser (token hash, user, expiry)
  jobs     -- which user created each job folder under jobs/. Jobs with no
              row (made before accounts existed) are visible to admins only.
  feedback -- messages sent from the website's Feedback page (on the VM:
              from every machine), with the sender's name and email.
  user_avatars -- each account's profile photo (on the VM: for every
              machine's users).
  scenes   -- Scene Builder scenes, each a versioned JSON document.
  synced_jobs, job_images, job_models, job_model_chunks -- the shared
              library (see below).
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
- backupDatabase()
A consistent copy of app.db (VACUUM INTO), safe while running.
- storeJobImages(jobId, imagesDir) / listDbImageNames / getDbImage /
  deleteDbImages / hasDbImages
On the VM with FILE_STORE=db: finished jobs' photos are kept in the table
job_images instead of jobs/<id>/images/ (see dbstore.js).
- storeJobModel(jobId, filePath) / getDbModelInfo / readDbModelChunk /
  deleteDbModel / hasDbModels
On the VM with FILE_STORE=db: finished models are kept in the tables
job_models (size) and job_model_chunks (the .ply in 4 MiB pieces) instead
of jobs/<id>_out/result.ply, so a byte range or a download never has to
load a whole model into memory.
- addFeedback({ userId, email, name, category, message, origin })
Stores one feedback message and returns its id.
- listFeedback({ category, before, limit })
One page of feedback for the admins' Inbox, newest first.
- deleteOldFeedback(days) / getDbJobBytes(jobId)
For the VM's clean-up (cleanup.js): removes feedback older than a number
of days / how many bytes a job's photos and model take in the database.
- getAccount(userId)
What the account page shows: name, email, role, dates, which sign-in
methods the account has, and whether it has a photo.
- updateUserName / setUserPassword / endOtherSessions
Account page edits: the name; a new password (recording when); logging
the account out of every other browser after a password change.
- setUserAvatar / getUserAvatar / deleteUserAvatar
The profile photo (table user_avatars).
- listScenes / getScene / insertScene / updateScene / deleteScene
A user's saved scenes (table scenes). The documents are checked and
converted in services/scenes.js; this file only stores them.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { config } from './config.js'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from './migrate.js'

const scrypt = promisify(crypto.scrypt)

// data/ next to this file, unless DATA_DIR says otherwise (config.js).
const DATA_DIR = config.dataDir

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
// Write-ahead log: reading (e.g. serving photos from job_images) doesn't
// block writing, or the other way round. Backups must then use VACUUM INTO
// (or stop the backend first), not a plain copy of app.db.
db.exec('PRAGMA journal_mode = WAL')
// Storing a model is one big transaction, which grows app.db-wal to the
// model's size; shrink it back to at most 64 MB after each checkpoint.
db.exec('PRAGMA journal_size_limit = 67108864')

// Create or update the tables (migrations/). A database that already has
// tables is backed up first. Every statement below expects the newest schema.
await runMigrations(db, {
  backup: backupDatabase,
  log: (line) => console.log(`[backend] database: ${line}`),
})

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
// id (the ID token's "sub", unique per account).
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

// Account page: password_changed_at is NULL until the first change after
// signup; user_avatars holds each user's profile photo (one small image).
const selectAccount = db.prepare(`
  SELECT u.id, u.email, u.name, u.role, u.created_at, u.password_hash, u.google_sub,
         u.password_changed_at, a.updated_at AS avatar_updated_at
  FROM users u LEFT JOIN user_avatars a ON a.user_id = u.id
  WHERE u.id = ?
`)
const updateUserNameById = db.prepare('UPDATE users SET name = ? WHERE id = ?')
const updateUserPassword = db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?')
const deleteOtherSessionsForUser = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
const upsertAvatar = db.prepare(`
  INSERT INTO user_avatars (user_id, mime, data, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at
`)
const selectAvatar = db.prepare('SELECT mime, data, updated_at FROM user_avatars WHERE user_id = ?')
const deleteAvatar = db.prepare('DELETE FROM user_avatars WHERE user_id = ?')
// password_hash values that aren't a password: Google-only accounts and
// copies of VM accounts on client machines.
const NO_PASSWORD_HASHES = new Set(['google-sso', 'remote'])

// Shared library: on the VM, jobs.origin / jobs.bytes say where each stored
// job came from and how much disk it takes. On a client machine,
// synced_jobs lists the finished jobs the VM has already received, so each
// is sent once (not a column on jobs: old jobs may have no jobs row).
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

// On the VM with FILE_STORE=db: each finished job's photos, stored whole in
// job_images (photos are small enough, and <img> never asks for byte
// ranges). Deleting the job's jobs row deletes its photos.
// The photos need a jobs row (foreign key). OR IGNORE: an existing row keeps
// its owner; a job with no row (older, ownerless) stays admin-only.
const ensureJobRow = db.prepare('INSERT OR IGNORE INTO jobs (id) VALUES (?)')
const insertJobImage = db.prepare('INSERT INTO job_images (job_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?)')
const deleteJobImages = db.prepare('DELETE FROM job_images WHERE job_id = ?')
const selectJobImageNames = db.prepare('SELECT name FROM job_images WHERE job_id = ? ORDER BY name')
const selectJobImage = db.prepare('SELECT mime, size, data FROM job_images WHERE job_id = ? AND name = ?')
const selectAnyJobImage = db.prepare('SELECT 1 FROM job_images LIMIT 1')

const PHOTO_NAME_RE = /\.(jpe?g|png)$/i

// On the VM with FILE_STORE=db: each finished model (.ply, often hundreds of
// MB) in fixed-size pieces. SQLite reads a value whole, so pieces let a
// byte range (the viewer's 4 KB header read) or a download read only what it
// needs (tables job_models and job_model_chunks). Deleting the job's jobs
// row (or its job_models row) deletes them.

// Size of each piece. Stored per model (chunk_size), so changing it later
// doesn't break models already stored.
const MODEL_CHUNK_BYTES = 4 * 1024 * 1024
const insertJobModel = db.prepare('INSERT INTO job_models (job_id, size, chunk_size, stored_at) VALUES (?, ?, ?, ?)')
const insertModelChunk = db.prepare('INSERT INTO job_model_chunks (job_id, seq, data) VALUES (?, ?, ?)')
const deleteJobModel = db.prepare('DELETE FROM job_models WHERE job_id = ?')
const selectJobModel = db.prepare('SELECT size, chunk_size, stored_at FROM job_models WHERE job_id = ?')
const selectModelChunk = db.prepare('SELECT data FROM job_model_chunks WHERE job_id = ? AND seq = ?')
const selectAnyJobModel = db.prepare('SELECT 1 FROM job_models LIMIT 1')

// Feedback from the website. The sender's email and name are copied in, so
// a message still says who sent it after their account is deleted.
const insertFeedback = db.prepare(
  'INSERT INTO feedback (user_id, user_email, user_name, category, message, origin) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
)
// Newest first; ?1 = category (NULL: all), ?2 = only ids below this (NULL:
// from the newest), ?3 = how many rows.
const deleteFeedbackOlderThan = db.prepare('DELETE FROM feedback WHERE created_at < ?')
// A job's photos + model in the database, in bytes.
const selectDbJobBytes = db.prepare(`
  SELECT (SELECT IFNULL(SUM(size), 0) FROM job_images WHERE job_id = ?1)
       + IFNULL((SELECT size FROM job_models WHERE job_id = ?1), 0) AS bytes
`)
const selectFeedbackPage = db.prepare(`
  SELECT id, user_name, user_email, category, message, origin, created_at FROM feedback
  WHERE (?1 IS NULL OR category = ?1) AND (?2 IS NULL OR id < ?2)
  ORDER BY id DESC LIMIT ?3
`)

// Scene Builder scenes: one JSON document per row (services/scenes.js).
// SQLite counts the objects in each document, so a list never parses whole scenes.
const selectSceneSummaries = db.prepare(`
  SELECT id, name, updated_at, json_array_length(document, '$.objects') AS object_count
  FROM scenes WHERE owner_id = ? ORDER BY updated_at DESC
`)
const selectScene = db.prepare('SELECT document FROM scenes WHERE id = ? AND owner_id = ?')
const insertSceneRow = db.prepare(`
  INSERT INTO scenes (id, owner_id, name, format_version, document, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)
const updateSceneRow = db.prepare(`
  UPDATE scenes SET name = ?, format_version = ?, document = ?, updated_at = ? WHERE id = ? AND owner_id = ?
`)
const deleteSceneRow = db.prepare('DELETE FROM scenes WHERE id = ? AND owner_id = ?')

// users rows as the rest of the backend sees them (camelCase, dates in ms).
function userFromRow(row)
{
  return row ? { id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at } : null
}


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
    return userFromRow(insertUser.get(email, name, passwordHash))
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
    { id, email, name, role, createdAt, passwordHash }, or null
*/
/************************************************************************/
export function findUserByEmail(email)
{
  const row = selectUserByEmail.get(email)
  return row ? { ...userFromRow(row), passwordHash: row.password_hash } : null
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
    { id, email, name, role, createdAt }, or null if the token is
    unknown or expired
*/
/************************************************************************/
export function findSessionUser(token)
{
  if (!token) return null
  return userFromRow(selectSessionUser.get(hashToken(token), Date.now()))
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

  const backupPath = backupDatabase()
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
  if (bySub) return userFromRow(bySub)

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
    return userFromRow(byEmail)
  }

  return userFromRow(insertGoogleUser.get(email, name || email, sub))
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
    { id, email, name, role, createdAt }, or null
*/
/************************************************************************/
export function findUserById(id)
{
  return userFromRow(selectUserById.get(id))
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

/************************************************************************/
/*!
  \brief
    A consistent copy of the whole database at data/app.db.bak-<time>,
    safe while the backend is running (VACUUM INTO, not a file copy).
  \return
    The backup's path
*/
/************************************************************************/
export function backupDatabase()
{
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(DATA_DIR, `app.db.bak-${stamp}`)
  db.prepare('VACUUM INTO ?').run(backupPath)
  return backupPath
}

/************************************************************************/
/*!
  \brief
    Stores every JPEG/PNG in a folder as the job's photos, replacing any
    it already had. One transaction: either all photos are stored or none
    (it throws, and the caller keeps the folder). Files are read one at a
    time, so memory use is one photo at a time.
  \param jobId
  string
  \param imagesDir
  string
    The folder holding the photos (jobs/<id>/images or a staging copy)
  \return
    { count, bytes }
*/
/************************************************************************/
export function storeJobImages(jobId, imagesDir)
{
  const names = fs.readdirSync(imagesDir).filter((n) => PHOTO_NAME_RE.test(n)).sort()
  let bytes = 0
  db.exec('BEGIN')
  try
  {
    ensureJobRow.run(jobId)
    deleteJobImages.run(jobId)
    for (const name of names)
    {
      const data = fs.readFileSync(path.join(imagesDir, name))
      const mime = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg'
      insertJobImage.run(jobId, name, mime, data.length, data)
      bytes += data.length
    }
    db.exec('COMMIT')
  }
  catch (err)
  {
    db.exec('ROLLBACK')
    throw err
  }
  return { count: names.length, bytes }
}

/************************************************************************/
/*!
  \brief
    The names of a job's photos in the database, sorted (0000.jpg, ...).
  \param jobId
  string
  \return
    string[] (empty if none)
*/
/************************************************************************/
export function listDbImageNames(jobId)
{
  return selectJobImageNames.all(jobId).map((row) => row.name)
}

/************************************************************************/
/*!
  \brief
    One photo from the database.
  \param jobId
  string
  \param name
  string
  \return
    { mime, size, data: Buffer }, or null
*/
/************************************************************************/
export function getDbImage(jobId, name)
{
  const row = selectJobImage.get(jobId, name)
  if (!row) return null
  // node:sqlite returns BLOBs as Uint8Array; wrapped (no copy) as the Buffer
  // the rest of Node code expects.
  return { mime: row.mime, size: row.size, data: Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength) }
}

/************************************************************************/
/*!
  \brief
    Whether any photos are stored in the database yet.
  \return
    bool
*/
/************************************************************************/
export function hasDbImages()
{
  return Boolean(selectAnyJobImage.get())
}

/************************************************************************/
/*!
  \brief
    Removes a job's photos from the database (the job is being deleted).
  \param jobId
  string
*/
/************************************************************************/
export function deleteDbImages(jobId)
{
  deleteJobImages.run(jobId)
}

/************************************************************************/
/*!
  \brief
    Stores a finished model (.ply) as the job's model, replacing any it
    already had. One transaction: either the whole file is stored or
    nothing is (it throws, and the caller keeps the file). The file is
    read MODEL_CHUNK_BYTES at a time, so memory use stays at one piece.
    Synchronous on purpose: the backend shares this one connection, so an
    await inside the transaction would let other requests' writes land in
    it (and be rolled back with it).
  \param jobId
  string
  \param filePath
  string
    The model file (jobs/<id>_out/result.ply or a staging copy)
  \return
    { size } in bytes
*/
/************************************************************************/
export function storeJobModel(jobId, filePath)
{
  const fd = fs.openSync(filePath, 'r')
  try
  {
    const size = fs.fstatSync(fd).size
    db.exec('BEGIN')
    try
    {
      ensureJobRow.run(jobId)
      deleteJobModel.run(jobId)
      insertJobModel.run(jobId, size, MODEL_CHUNK_BYTES, Date.now())
      let offset = 0
      for (let seq = 0; offset < size; seq++)
      {
        const chunk = Buffer.allocUnsafe(Math.min(MODEL_CHUNK_BYTES, size - offset))
        let filled = 0
        while (filled < chunk.length)
        {
          const read = fs.readSync(fd, chunk, filled, chunk.length - filled, offset + filled)
          if (read === 0) throw new Error(`${path.basename(filePath)} got shorter while it was being stored`)
          filled += read
        }
        insertModelChunk.run(jobId, seq, chunk)
        offset += chunk.length
      }
      db.exec('COMMIT')
      return { size }
    }
    catch (err)
    {
      db.exec('ROLLBACK')
      throw err
    }
  }
  finally
  {
    fs.closeSync(fd)
  }
}

/************************************************************************/
/*!
  \brief
    A stored model's details, without its data.
  \param jobId
  string
  \return
    { size, chunkSize, storedAt }, or null if the job has no stored model
*/
/************************************************************************/
export function getDbModelInfo(jobId)
{
  const row = selectJobModel.get(jobId)
  return row ? { size: row.size, chunkSize: row.chunk_size, storedAt: row.stored_at } : null
}

/************************************************************************/
/*!
  \brief
    One piece of a stored model: bytes [seq * chunkSize, (seq + 1) *
    chunkSize) of the .ply.
  \param jobId
  string
  \param seq
  number
    The piece's index, from 0
  \return
    Buffer, or null if there is no such piece (e.g. the job was deleted)
*/
/************************************************************************/
export function readDbModelChunk(jobId, seq)
{
  const row = selectModelChunk.get(jobId, seq)
  // Wrapped (no copy) as a Buffer, like getDbImage.
  return row ? Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength) : null
}

/************************************************************************/
/*!
  \brief
    Whether any models are stored in the database yet.
  \return
    bool
*/
/************************************************************************/
export function hasDbModels()
{
  return Boolean(selectAnyJobModel.get())
}

/************************************************************************/
/*!
  \brief
    Removes a job's model from the database (its pieces go with it).
  \param jobId
  string
*/
/************************************************************************/
export function deleteDbModel(jobId)
{
  deleteJobModel.run(jobId)
}

/************************************************************************/
/*!
  \brief
    Stores one message from the website's Feedback page.
  \param userId
  number
    The sender's user id
  \param email
  string
  \param name
  string
  \param category
  string
    'bug', 'idea' or 'other'
  \param message
  string
  \param origin
  string or null
    The machine it was sent from
  \return
    The new feedback id
*/
/************************************************************************/
export function addFeedback({ userId, email, name, category, message, origin })
{
  return insertFeedback.get(userId, email, name, category, message, origin ?? null).id
}

/************************************************************************/
/*!
  \brief
    One page of feedback for the admins' Inbox, newest first.
  \param category
  string or null
    'bug', 'idea' or 'other'; null for all
  \param before
  number or null
    Only messages older than this id (the last one already shown)
  \param limit
  number
    Page size
  \return
    { items: [{ id, name, email, category, message, origin, createdAt }],
      hasMore }, createdAt in ms
*/
/************************************************************************/
export function listFeedback({ category = null, before = null, limit = 50 })
{
  // One extra row says whether another page exists.
  const rows = selectFeedbackPage.all(category, before, limit + 1)
  return {
    items: rows.slice(0, limit).map((row) => ({
      id: row.id,
      name: row.user_name,
      email: row.user_email,
      category: row.category,
      message: row.message,
      origin: row.origin,
      createdAt: row.created_at,
    })),
    hasMore: rows.length > limit,
  }
}

/************************************************************************/
/*!
  \brief
    Deletes feedback older than a number of days (the VM's clean-up).
  \param days
  number
  \return
    How many messages were deleted
*/
/************************************************************************/
export function deleteOldFeedback(days)
{
  return Number(deleteFeedbackOlderThan.run(Date.now() - Math.floor(days) * 24 * 60 * 60 * 1000).changes)
}

/************************************************************************/
/*!
  \brief
    How much a job takes in the database: its photos plus its model.
  \param jobId
  string
  \return
    bytes (0 if it has nothing in the database)
*/
/************************************************************************/
export function getDbJobBytes(jobId)
{
  return Number(selectDbJobBytes.get(jobId).bytes)
}

/************************************************************************/
/*!
  \brief
    Everything the account page shows about a user. Never includes the
    password hash, only whether there is a password.
  \param userId
  number
  \return
    { id, email, name, role, createdAt, hasPassword, hasGoogle,
    passwordChangedAt, avatarUpdatedAt } (the two dates are null when
    never changed / no photo), or null if there is no such user
*/
/************************************************************************/
export function getAccount(userId)
{
  const row = selectAccount.get(userId)
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    hasPassword: !NO_PASSWORD_HASHES.has(row.password_hash),
    hasGoogle: Boolean(row.google_sub),
    passwordChangedAt: row.password_changed_at,
    avatarUpdatedAt: row.avatar_updated_at ?? null,
  }
}

/************************************************************************/
/*!
  \brief
    Changes a user's display name.
  \param userId
  number
  \param name
  string (already checked)
*/
/************************************************************************/
export function updateUserName(userId, name)
{
  updateUserNameById.run(name, userId)
}

/************************************************************************/
/*!
  \brief
    Sets a new password (hashed, like createUser) and records when it
    changed.
  \param userId
  number
  \param password
  string (already checked)
*/
/************************************************************************/
export async function setUserPassword(userId, password)
{
  updateUserPassword.run(await hashPassword(password), Date.now(), userId)
}

/************************************************************************/
/*!
  \brief
    Logs a user out everywhere except one session (after a password
    change, the browser that changed it stays signed in).
  \param userId
  number
  \param keepToken
  string | null
    The raw cookie token of the session to keep; null logs out all of them
  \return
    How many sessions were ended
*/
/************************************************************************/
export function endOtherSessions(userId, keepToken)
{
  const result = keepToken
    ? deleteOtherSessionsForUser.run(userId, hashToken(keepToken))
    : deleteSessionsForUser.run(userId)
  return Number(result.changes)
}

/************************************************************************/
/*!
  \brief
    Saves (or replaces) a user's profile photo.
  \param userId
  number
  \param mime
  string ('image/jpeg' or 'image/png', already checked)
  \param data
  Buffer
  \return
    updated_at (ms), which also serves as the photo's version
*/
/************************************************************************/
export function setUserAvatar(userId, mime, data)
{
  // Strictly increasing, so a photo replaced within the same millisecond still gets a new version.
  const previous = selectAvatar.get(userId)?.updated_at ?? 0
  const updatedAt = Math.max(Date.now(), previous + 1)
  upsertAvatar.run(userId, mime, data, updatedAt)
  return updatedAt
}

/************************************************************************/
/*!
  \brief
    A user's profile photo.
  \param userId
  number
  \return
    { mime, data (Buffer), updatedAt }, or null if none is set
*/
/************************************************************************/
export function getUserAvatar(userId)
{
  const row = selectAvatar.get(userId)
  return row ? { mime: row.mime, data: Buffer.from(row.data), updatedAt: row.updated_at } : null
}

/************************************************************************/
/*!
  \brief
    Removes a user's profile photo. Does nothing if there isn't one.
  \param userId
  number
*/
/************************************************************************/
export function deleteUserAvatar(userId)
{
  deleteAvatar.run(userId)
}

/************************************************************************/
/*!
  \brief
    A user's saved scenes, newest first, for the Scene Builder's list.
  \param ownerId
  number
  \return
    [{ id, name, updatedAt, objectCount }]
*/
/************************************************************************/
export function listScenes(ownerId)
{
  return selectSceneSummaries.all(ownerId).map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    objectCount: row.object_count ?? 0,
  }))
}

/************************************************************************/
/*!
  \brief
    One of a user's scenes, as it was saved.
  \param id
  string
  \param ownerId
  number
  \return
    The scene document (parsed JSON), or null if the user has no such scene
*/
/************************************************************************/
export function getScene(id, ownerId)
{
  const row = selectScene.get(id, ownerId)
  return row ? JSON.parse(row.document) : null
}

/************************************************************************/
/*!
  \brief
    Saves a new scene / replaces one of the user's scenes. The document is
    stored exactly as given (already checked by services/scenes.js).
  \param ownerId
  number
  \param scene
    The scene document ({ id, name, version, createdAt, updatedAt, ... })
  \return
    true if saved (updateScene: false if the user has no such scene)
*/
/************************************************************************/
export function insertScene(ownerId, scene)
{
  insertSceneRow.run(scene.id, ownerId, scene.name, scene.version, JSON.stringify(scene), scene.createdAt, scene.updatedAt)
  return true
}

export function updateScene(ownerId, scene)
{
  const { changes } = updateSceneRow.run(scene.name, scene.version, JSON.stringify(scene), scene.updatedAt, scene.id, ownerId)
  return Number(changes) > 0
}

/************************************************************************/
/*!
  \brief
    Deletes one of a user's scenes.
  \param id
  string
  \param ownerId
  number
  \return
    true if a scene was deleted
*/
/************************************************************************/
export function deleteScene(id, ownerId)
{
  return Number(deleteSceneRow.run(id, ownerId).changes) > 0
}
// ----- End of Functions ----------------------------------------------------- //
