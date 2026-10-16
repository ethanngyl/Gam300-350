/*!************************************************************************
\file db.js
\author1 Gabriel Sebastian Putra
\par DP email1: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 13-10-2026
\brief
This source file owns the SQLite database (node:sqlite, built into Node)
that stores user accounts. The file lives at data/app.db next to this file
and is created on first run. Passwords are never stored: only a salted
scrypt hash.
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

// DatabaseSync can't create the folder, only the file.
fs.mkdirSync(DATA_DIR, { recursive: true })

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
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

const insertUser = db.prepare(
  'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) RETURNING id, email, name, created_at'
)
const selectUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?')

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
    Creates a user account with a hashed password.
  \param user
    { email, name, password }
  \return
    { id, email, name, createdAt }. Throws (code 'EMAIL_TAKEN') if the
    email is already registered.
*/
/************************************************************************/
export async function createUser({ email, name, password })
{
  const passwordHash = await hashPassword(password)
  try
  {
    const row = insertUser.get(email, name, passwordHash)
    return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at }
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

// ----- End of Functions ----------------------------------------------------- //
