/*!************************************************************************
\file google.js
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
Business logic: Google sign-in (VM only). No req / res; the routes in
routes/auth.js keep the state cookie and the redirects. Moved out of
server.js.
- googleSignInReady()
Whether Google sign-in is set up on this machine.
- googleConsentUrl(state)
Where to send the browser to choose a Google account.
- readGoogleSignIn(code)
Exchanges the code Google sent back for the user's verified email, name and
Google id, or null.
- safeEqual(a, b)
Constant-time string comparison (for the OAuth state).
Signing in from a team machine's website: Google only ever sends the
browser back to the VM, and a VM session cookie is no use on the team
machine's own address. So the VM hands the browser back to the team
machine with a one-time code, which that machine's backend redeems with the
VM (shared key) before starting its own session:
- GOOGLE_FINISH_PATH / isAllowedReturnUrl(value)
Where a team machine receives the browser back, and whether the VM may send
the browser to a given address (a loopback address or GOOGLE_RETURN_ORIGINS,
and only that path), so the VM can't be used to redirect anywhere else.
- createHandoffCode(userId) / redeemHandoffCode(code)
The one-time codes, kept in memory only (a hash of each), for
config.googleHandoffTtlSec seconds. Redeeming one deletes it.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import crypto from 'node:crypto'
import { config } from '../config.js'
import { API_V1_PREFIX } from '../adapters/apiVersions.js'

// Where a team machine's backend receives the browser back from the VM.
export const GOOGLE_FINISH_PATH = `${API_V1_PREFIX}/auth/google/finish`

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

// One-time codes waiting to be redeemed: SHA-256 of the code -> { userId, expiresAt }.
const handoffCodes = new Map()

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Constant-time string comparison, so the state can't be guessed by
    timing. Byte lengths are checked first because timingSafeEqual throws
    on unequal lengths.
  \param a
  string
  \param b
  string
  \return
    true if both are non-empty and equal
*/
/************************************************************************/
export function safeEqual(a, b) {
    const x = Buffer.from(String(a ?? ''))
    const y = Buffer.from(String(b ?? ''))
    return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y)
}

/************************************************************************/
/*!
  \brief
    Whether Google sign-in can run here: only on the VM (the redirect URI
    is registered against it), with the client id and redirect URI set.
  \return
    bool
*/
/************************************************************************/
export function googleSignInReady() {
    return config.authMode === 'authority' && Boolean(config.googleClientId) && Boolean(config.googleRedirectUri)
}

/************************************************************************/
/*!
  \brief
    Google's consent screen for this app, carrying the OAuth state.
  \param state
  string
    The random state also kept in the browser's state cookie
  \return
    URL string
*/
/************************************************************************/
export function googleConsentUrl(state) {
    const params = new URLSearchParams({
        client_id: config.googleClientId,
        redirect_uri: config.googleRedirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        // Ask for a fresh account chooser each time.
        prompt: 'select_account',
    })
    return `${config.googleAuthUrl}?${params}`
}

/************************************************************************/
/*!
  \brief
    Exchanges the code Google sent back for the signed-in Google account.
    Throws on a network failure or timeout.
  \param code
  string
    The ?code from Google's redirect
  \return
    { sub, email, name } of a verified Google email, or null if Google
    refused the code or the token isn't for this app
*/
/************************************************************************/
export async function readGoogleSignIn(code) {
    // 1. Exchange the code for tokens (server-to-server, uses the secret).
    const tokenResp = await fetch(config.googleTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code: String(code),
            client_id: config.googleClientId,
            client_secret: config.googleClientSecret,
            redirect_uri: config.googleRedirectUri,
            grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(8000),
    })
    const tokens = await tokenResp.json()
    if (!tokenResp.ok || !tokens.id_token) return null

    // 2. The ID token is a JWT; its middle segment is the JSON claims. Google
    //    just issued it to us over TLS from its own endpoint, so for sign-in
    //    we read the claims directly. (A stricter check would verify Google's
    //    signature against its public keys; acceptable to skip when the token
    //    came straight from Google's token endpoint over HTTPS.)
    const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString())
    if (claims.aud !== config.googleClientId || !claims.email || !claims.email_verified) return null
    return { sub: claims.sub, email: claims.email, name: claims.name }
}

/************************************************************************/
/*!
  \brief
    Whether the VM may send the browser to this address after Google
    sign-in: http(s), no user name or password in it, exactly
    GOOGLE_FINISH_PATH with nothing after it, on a loopback host (the team
    machine's own website, opened on that machine) or an origin listed in
    GOOGLE_RETURN_ORIGINS. Anything else would let a link made by someone
    else send people (and their one-time code) to another site.
  \param value
    The return_to address the team machine sent
  \return
    bool
*/
/************************************************************************/
export function isAllowedReturnUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return false
    let url
    try {
        url = new URL(value)
    }
    catch {
        return false
    }
    if (!['http:', 'https:'].includes(url.protocol)) return false
    if (url.username || url.password || url.search || url.hash) return false
    if (url.pathname !== GOOGLE_FINISH_PATH) return false
    return LOOPBACK_HOSTS.includes(url.hostname) || config.googleReturnOrigins.includes(url.origin)
}

/************************************************************************/
/*!
  \brief
    Drops the codes whose time is up, so the map can't keep growing.
  \param now
  number
    The current time (epoch ms)
*/
/************************************************************************/
function sweepHandoffCodes(now) {
    for (const [hash, entry] of handoffCodes) {
        if (entry.expiresAt <= now) handoffCodes.delete(hash)
    }
}

const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex')

/************************************************************************/
/*!
  \brief
    A new one-time code for a user who just signed in with Google on the
    VM, for the team machine they came from. Only its hash is kept, like
    the session tokens, and only in memory: a VM restart just means signing
    in again.
  \param userId
  number
    The VM account's id
  \return
    The code (string, 43 characters)
*/
/************************************************************************/
export function createHandoffCode(userId) {
    const now = Date.now()
    sweepHandoffCodes(now)
    const code = crypto.randomBytes(32).toString('base64url')
    handoffCodes.set(hashCode(code), { userId, expiresAt: now + config.googleHandoffTtlSec * 1000 })
    return code
}

/************************************************************************/
/*!
  \brief
    Redeems a one-time code: once only, and only before it expires.
  \param code
  string
    The code a team machine's backend sent
  \return
    The user's id, or null for an unknown, used or expired code
*/
/************************************************************************/
export function redeemHandoffCode(code) {
    const now = Date.now()
    sweepHandoffCodes(now)
    if (typeof code !== 'string' || code.length === 0 || code.length > 256) return null
    const hash = hashCode(code)
    const entry = handoffCodes.get(hash)
    if (!entry) return null
    handoffCodes.delete(hash)
    return entry.userId
}
