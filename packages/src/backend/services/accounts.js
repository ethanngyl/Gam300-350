/*!************************************************************************
\file accounts.js
\author1 Gabriel Sebastian Putra
\author2 Xiong Yang
\author3 Ethan Ng
\par DP email1: gabrielsebastian.p@digipen.edu
\par DP email2: xiong.yang@digipen.edu
\par DP email3: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Business logic: account rules shared by the auth and account routes. No
req / res. Moved out of server.js.
- validateSignup(body)
The signup rules (email shape, password length, name), shared by
/auth/signup and the VM's /register.
- checkCredentials(email, password)
The password check, with a per-email limit of 10 wrong passwords per 15
minutes. Shared by /auth/login, the VM's /verify-account and the password
change.
- publicUser(user) / accountDetails(userId)
What the frontend is told about a user (never the password hash), and the
account page's details.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { createLimiter } from '../ratelimit.js'
import { findUserByEmail, getAccount, verifyPassword } from '../db.js'

const EMAIL_RE = /^\S+@\S+\.\S+$/

// Wrong passwords per email, wherever passwords are checked (authority or
// local), so attempts relayed through client machines count too.
const failedLoginLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 10 })

// Shared by signup and the account page's password change.
export const MIN_PASSWORD_LENGTH = 6

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Checks a signup body. Shared by /auth/signup (authority / local) and
    the VM's /register so the rules stay identical.
  \param body
    { name, email, password }
  \return
    { error } if invalid, else { name, email, password } with name and
    email trimmed
*/
/************************************************************************/
export function validateSignup(body) {
    const { name, email, password } = body || {}
    const trimmedEmail = typeof email === 'string' ? email.trim() : ''
    const trimmedName = typeof name === 'string' ? name.trim() : ''
    if (!EMAIL_RE.test(trimmedEmail)) return { error: 'Enter a valid email address.' }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH)
        return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
    if (!trimmedName) return { error: 'Enter your name.' }
    return { name: trimmedName, email: trimmedEmail, password }
}

/************************************************************************/
/*!
  \brief
    Checks an email + password against this machine's accounts, with the
    per-email failure limit: after 10 wrong passwords in 15 minutes that
    email is locked until the window ends, even with the right password.
    A correct password clears the count. Shared by /auth/login (authority /
    local) and the VM's /verify-account.
  \param email
  string
  \param password
  string
  \return
    { status: 'ok', user } | { status: 'invalid' } |
    { status: 'locked', retryAfterSec }
*/
/************************************************************************/
export async function checkCredentials(email, password) {
    const key = email.trim().toLowerCase()
    const lock = failedLoginLimiter.check(key)
    if (!lock.allowed) return { status: 'locked', retryAfterSec: lock.retryAfterSec }

    const user = findUserByEmail(email.trim())
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
        failedLoginLimiter.hit(key)
        return { status: 'invalid' }
    }
    failedLoginLimiter.reset(key)
    return { status: 'ok', user }
}

/************************************************************************/
/*!
  \brief
    Shapes a user (from db.js) into what the frontend keeps as the session.
    Never includes the password hash. This is the API v1 shape; the
    legacy API turns createdAt into ISO text (adapters/apiVersions.js).
  \param user
    { email, name, role, createdAt (ms) }
  \return
    { name, email, role, createdAt (ms), memberSince ("4 October 2026") }
*/
/************************************************************************/
export function publicUser(user) {
    return {
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        memberSince: new Date(user.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' }),
    }
}

/************************************************************************/
/*!
  \brief
    Everything the account page shows about a user: publicUser plus
    whether the email is verified (only Google accounts, for now: Google
    has checked the address), when the password last changed, which ways
    the account can sign in, and the photo's version.
  \param userId
  number
  \return
    { name, email, role, createdAt, memberSince, emailVerified,
    passwordChangedAt (ms, or null if never changed since signup),
    signInMethods: { password, google }, photoVersion (null: no photo) },
    or null if there is no such user
*/
/************************************************************************/
export function accountDetails(userId) {
    const account = getAccount(userId)
    if (!account) return null
    return {
        ...publicUser(account),
        emailVerified: account.hasGoogle,
        passwordChangedAt: account.passwordChangedAt ?? null,
        signInMethods: { password: account.hasPassword, google: account.hasGoogle },
        photoVersion: account.avatarUpdatedAt,
    }
}
