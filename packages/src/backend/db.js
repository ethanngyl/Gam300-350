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

// ----- End of Functions ----------------------------------------------------- //
