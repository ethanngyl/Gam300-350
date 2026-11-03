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
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import crypto from 'node:crypto'
import { config } from '../config.js'

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
