# `backend/services/accounts.js`

Business logic: account rules shared by the auth and account routes. There is no `req` or `res` here.

## Constants
- `EMAIL_RE = /^\S+@\S+\.\S+$/`.
- `failedLoginLimiter`: **10 wrong passwords per email per 15 minutes**. It counts wherever passwords are checked (on the authority or locally), so attempts relayed through client machines count too.
- `MIN_PASSWORD_LENGTH = 8`, `UPPERCASE_RE = /\p{Lu}/u` and `SPECIAL_RE = /[^\p{L}\p{N}\s]/u` (anything but a letter, digit or space): the new-password rules, shared by sign-up, password change and password reset. The web app shows the same rules ([PasswordRules.js](../../frontend/web-app/auth-account.md#passwordrulesjs)).

## Functions

### `isValidEmail(email)`
True for a string that matches the sign-up email rule.

### `clearLoginFailures(email)`
Resets the lockout for that email (trimmed and lower-cased). Used after a password reset, so the owner can sign in straight away.

### `passwordProblem(password)`
Checks a **new** password: at least 8 characters, an uppercase letter and a special character. Returns `null` when it meets every rule, otherwise one sentence naming everything missing (for example *"Password needs at least 8 characters, an uppercase letter and a special character (e.g. ! @ # $)."*). Signing in never calls it, so older, weaker passwords still log in.

### `validateSignup(body)`
Trims the name and email. Returns `{ error }` for *"Enter a valid email address."*, `passwordProblem`'s message or *"Enter your name."*, and otherwise the cleaned `{ name, email, password }`. `/auth/signup` and the VM's `/register` both use it, so the rules stay identical.

### `checkCredentials(email, password)` *(async)*
1. If the email is **locked**, it returns `{ status: 'locked', retryAfterSec }`. This applies **even when the password is correct**.
2. It looks up the user and runs `verifyPassword`. An unknown email or a wrong password counts as a failure and returns `{ status: 'invalid' }`.
3. A correct password **clears the count** and returns `{ status: 'ok', user }`.

Used by `/auth/login`, the VM's `/verify-account` and the password change.

### `publicUser(user)`
What the frontend stores as the session: `{ name, email, role, createdAt (ms), memberSince }`, where `memberSince` is formatted like *"4 October 2026"* (`en-SG`). It **never includes the password hash**. This is the v1 shape; the legacy API turns `createdAt` into ISO text.

### `accountDetails(userId)`
`publicUser` plus `emailVerified` (currently only Google accounts, because Google has checked the address), `passwordChangedAt`, `signInMethods: { password, google }` and `photoVersion` (the avatar's `updated_at`, or `null` if there is no photo). Returns `null` if there is no such user.
