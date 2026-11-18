/*!************************************************************************
\file passwordReset.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-11-2026
\brief
Business logic: "Forgot password?" on the machine that holds the accounts
(the VM, or a machine in local mode). The user asks for a code, gets a
6-digit code by email (services/mail.js), and sends it back with a new
password. No req / res. Follows the OWASP Forgot Password Cheat Sheet:
- the code is random (crypto.randomInt), stored only as a salted scrypt
  hash, works once, for RESET_CODE_TTL_MIN minutes (15), and dies after
  MAX_WRONG_CODES wrong tries; a new request replaces it;
- nothing tells whether an email has an account: a request for an unknown
  email answers the same and takes about as long (the hash is still made,
  the email is sent in the background), and a reset with an unknown email,
  a wrong code or an expired code all fail the same way;
- per-email limits: one request a minute, 3 an hour;
- a reset signs the account out everywhere, lifts its wrong-password lock
  and emails the owner that the password was changed.
- requestReset(email)
Makes and emails a new code if the email has an account.
- resetPassword({ email, code, newPassword })
Checks the code and sets the new password.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import crypto from 'node:crypto'
import { config } from '../config.js'
import {
  countResetAttempt, deletePasswordReset, endOtherSessions, findUserByEmail, getPasswordReset,
  hashPassword, savePasswordReset, setUserPassword, verifyPassword,
} from '../db.js'
import { createLimiter } from '../ratelimit.js'
import { MIN_PASSWORD_LENGTH, clearLoginFailures } from './accounts.js'
import { sendMail } from './mail.js'

// Wrong codes allowed before a code stops working.
export const MAX_WRONG_CODES = 5

// Per email (lower case): at most one request a minute, and 3 an hour.
const requestCooldown = createLimiter({ windowMs: 60 * 1000, max: 1 })
const requestsPerHour = createLimiter({ windowMs: 60 * 60 * 1000, max: 3 })

// Checked against when there is no real code, so a wrong guess for an
// unknown email takes as long as one for a real account.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'))

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    A new 6-digit code, with leading zeros (000000 to 999999).
  \return
    string
*/
/************************************************************************/
function newCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

/************************************************************************/
/*!
  \brief
    Sends an email without making the request wait for it, so the reply
    takes as long whether or not the email has an account. A failure is
    only logged (never with the code in it).
  \param message
    { to, subject, text }
*/
/************************************************************************/
function sendInBackground(message) {
  sendMail(message).catch((err) =>
    console.error(`[backend] password reset: could not email ${message.to}: ${err.message}`))
}

/************************************************************************/
/*!
  \brief
    "Forgot password?": if the email has an account, makes a new code
    (replacing any earlier one) and emails it. The answer is the same for
    an email without an account.
  \param email
  string
    Already checked to look like an email address
  \return
    Promise of { status: 'sent' } or { status: 'limited', retryAfterSec }
*/
/************************************************************************/
export async function requestReset(email) {
  const trimmed = email.trim()
  const key = trimmed.toLowerCase()
  for (const limiter of [requestCooldown, requestsPerHour]) {
    const { allowed, retryAfterSec } = limiter.check(key)
    if (!allowed) return { status: 'limited', retryAfterSec }
  }
  requestCooldown.hit(key)
  requestsPerHour.hit(key)

  const code = newCode()
  const codeHash = await hashPassword(code)
  const user = findUserByEmail(trimmed)
  if (!user) return { status: 'sent' }

  savePasswordReset(user.id, codeHash, Date.now() + config.resetCodeTtlMin * 60 * 1000)
  sendInBackground({
    to: user.email,
    subject: `Your Genesis password reset code: ${code}`,
    text: [
      `Hi ${user.name},`,
      '',
      `Your code to reset your Genesis password is: ${code}`,
      '',
      `It works once, for ${config.resetCodeTtlMin} minutes. Enter it on the sign-in page with your new password.`,
      '',
      'If you didn\'t ask to reset your password, ignore this email: your password stays the same.',
      '',
    ].join('\n'),
  })
  return { status: 'sent' }
}

/************************************************************************/
/*!
  \brief
    Sets a new password with a code from requestReset. An unknown email, a
    wrong code and an expired or used-up code all answer 'invalid'. Each
    wrong code counts; after MAX_WRONG_CODES the code is deleted.
  \param input
    { email, code, newPassword } (strings)
  \return
    Promise of { status: 'ok', userId } | { status: 'invalid' } |
    { status: 'weak' } (new password too short)
*/
/************************************************************************/
export async function resetPassword({ email, code, newPassword }) {
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { status: 'weak' }

  const user = findUserByEmail(email.trim())
  const reset = user ? getPasswordReset(user.id) : null
  if (!reset || reset.expiresAt <= Date.now() || reset.attempts >= MAX_WRONG_CODES) {
    if (reset) deletePasswordReset(user.id)
    await verifyPassword(String(code), DUMMY_HASH) // same time as a real check
    return { status: 'invalid' }
  }

  const right = /^\d{6}$/.test(code) && (await verifyPassword(code, reset.codeHash))
  if (!right) {
    if (countResetAttempt(user.id) >= MAX_WRONG_CODES) deletePasswordReset(user.id)
    return { status: 'invalid' }
  }

  deletePasswordReset(user.id)
  await setUserPassword(user.id, newPassword)
  endOtherSessions(user.id, null) // signed out everywhere
  clearLoginFailures(user.email)
  sendInBackground({
    to: user.email,
    subject: 'Your Genesis password was changed',
    text: [
      `Hi ${user.name},`,
      '',
      'The password of your Genesis account was just changed with a reset code, and every device was signed out.',
      '',
      'If this wasn\'t you, reset your password again straight away and tell a team admin.',
      '',
    ].join('\n'),
  })
  return { status: 'ok', userId: user.id }
}
// ----- End of Functions ----------------------------------------------------- //
