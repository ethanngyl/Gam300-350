# `backend/services/google.js`

Business logic for **Google sign-in** (OAuth 2.0 / OpenID Connect), on the **VM only**. The routes in [routes/auth](../routes/auth.md) handle the state cookie and the redirects.

### Signing in from a team machine
Google only ever sends the browser back to the VM, and a VM session cookie is no use on a team machine's own address. So the VM hands the browser back to the team machine with a **one-time code**. That machine's backend redeems the code with the VM (using the shared key) and then starts its own session.

## Constants
- `GOOGLE_FINISH_PATH = '/api/v1/auth/google/finish'`: where a team machine receives the browser back.
- `LOOPBACK_HOSTS`: `localhost`, `127.0.0.1`, `[::1]`.
- `handoffCodes`: a Map from **the SHA-256 of a code** to `{ userId, expiresAt }`, kept in memory only.

## Functions

### `safeEqual(a, b)`
Constant-time comparison with `crypto.timingSafeEqual`. Lengths are checked first, because `timingSafeEqual` throws on unequal lengths. True only if both strings are non-empty and equal. Used to compare the OAuth `state`.

### `googleSignInReady()`
True on the **authority** with `GOOGLE_CLIENT_ID` and `GOOGLE_REDIRECT_URI` set.

### `googleConsentUrl(state)`
`googleAuthUrl?client_id&redirect_uri&response_type=code&scope=openid email profile&state&prompt=select_account`. `select_account` shows a fresh account chooser every time.

### `readGoogleSignIn(code)` *(async)*
1. **Exchanges the code** at `googleTokenUrl` server to server (using the client secret, 8 s timeout).
2. Decodes the middle segment of the **ID token** (a JWT) to read its claims. The token came straight from Google's endpoint over TLS, so its signature is not checked separately (the code comment explains this).
3. Requires `aud === clientId`, an `email`, and `email_verified`. Returns `{ sub, email, name }`, where `name` falls back to the part of the email before `@`, or `null` if Google refused the code or the token is not for this app.

### `isAllowedReturnUrl(value)`
Whether the VM may send the browser to this address after sign-in. It must be a string of at most 2048 characters, a valid `http(s)` URL with **no username, password, query or fragment**, with a path of **exactly `GOOGLE_FINISH_PATH`**, on a **loopback host** or an origin listed in `GOOGLE_RETURN_ORIGINS`. Anything else would let a link made by someone else send people, and their one-time code, to another site.

### `sweepHandoffCodes(now)` *(private)* / `hashCode(code)` *(private)*
`sweepHandoffCodes` drops expired codes so the map cannot keep growing. `hashCode` is SHA-256 in hex.

### `createHandoffCode(userId)`
32 random bytes as base64url (43 characters). Only its **hash** is stored, with an expiry of `googleHandoffTtlSec` (60 s). Stored in memory only, so after a VM restart the user simply signs in again.

### `redeemHandoffCode(code)`
Sweeps expired codes first and rejects anything that is not a string of 1–256 characters. It looks up the hash and **deletes it** (so each code works **once only**), then returns the `userId`, or `null` for an unknown, used or expired code.
