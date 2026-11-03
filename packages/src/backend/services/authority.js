/*!************************************************************************
\file authority.js
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
Business logic: talking to the account authority (the VM) from a client
machine. No req / res. Moved out of server.js.
- callAuthority(endpoint, body)
Forwards signup/login to the VM's /register or /verify-account (8 s timeout).
- clientAuthProblem()
Why this machine can't talk to the VM safely (no key, no VM_AUTH_URL, plain
http://), or null.
- logAuthorityFailure(endpoint, status, data)
Names setup mistakes in the log.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { config } from '../config.js'
import { API_V1_PREFIX } from '../adapters/apiVersions.js'

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Call the account authority (VM). Adds the shared API key and parses the
    JSON reply. Gives up after 8 seconds so a VM that is down can't leave
    the Sign in button spinning. Throws on a network failure or timeout so
    the route can answer 503.
  \param endpoint  '/register' or '/verify-account'
  \param body      the JSON payload
  \return          { status, data }
*/
/************************************************************************/
export async function callAuthority(endpoint, body) {
    const resp = await fetch(`${config.vmAuthUrl}${API_V1_PREFIX}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Key': config.authApiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
    })
    const data = await resp.json().catch(() => ({}))
    return { status: resp.status, data }
}

/************************************************************************/
/*!
  \brief
    In client mode, why this machine can't talk to the VM safely, or null
    if it can. Checked before every call, and logged once at startup.
  \return
    string describing the problem, or null
*/
/************************************************************************/
export function clientAuthProblem() {
    if (!config.authApiKey)
        return 'AUTH_API_KEY is not set (see packages/src/backend/.env.example).'
    if (!config.vmAuthUrl)
        return 'VM_AUTH_URL is not set (see packages/src/backend/.env.example).'
    let url
    try {
        url = new URL(config.vmAuthUrl)
    }
    catch
    {
        return `VM_AUTH_URL "${config.vmAuthUrl}" is not a valid URL.`
    }
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !isLocal && !config.allowInsecureAuth)
        return `VM_AUTH_URL must be https:// (passwords are sent to it). ` +
            `Set AUTH_ALLOW_HTTP=1 only for temporary testing.`
    return null
}

/************************************************************************/
/*!
  \brief
    Turns an unexpected reply from the VM into a log line naming the likely
    cause, so a setup mistake doesn't look like a wrong password.
  \param endpoint
    '/register' or '/verify-account'
  \param status
    The VM's HTTP status
  \param data
    The VM's JSON reply
*/
/************************************************************************/
export function logAuthorityFailure(endpoint, status, data) {
    const cause =
        status === 401 ? 'the VM rejected this machine\'s AUTH_API_KEY (keys must match exactly)' :
            status === 503 ? 'the VM is not running with AUTH_MODE=authority' :
                `unexpected reply ${status}: ${JSON.stringify(data)}`
    console.error(`[backend] account authority ${endpoint} failed -- ${cause}`)
}
