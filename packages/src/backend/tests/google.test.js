/*!************************************************************************
\file google.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 14-11-2026
\brief
Google sign-in, against a fake Google (a small local server standing in for
Google's account chooser and token endpoint). A sign-in started on the VM's
website ends there, as before. One started on a team machine's website ends
back on the team machine: the VM returns the browser with a one-time code,
which the team machine redeems with the VM (shared key) and turns into its
own session. The code works once and expires, the team machine's state must
match, and the VM never sends the browser to an address it doesn't allow.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, test } from 'node:test'
import { call, openDb, sessionCookie, startServer, tempDir } from './helpers.js'

const KEY = 'test-shared-key-0123456789'
const CLIENT_ID = 'test-client.apps.googleusercontent.com'
const HANDOFF_TTL_SEC = 3

// The Google accounts the fake Google signs in, by the code it "sends back".
const GOOGLE_ACCOUNTS = {
  'code-alice': { sub: 'google-alice', email: 'alice@example.com', name: 'Alice' },
  'code-bob': { sub: 'google-bob', email: 'bob@example.com', name: 'Bob' },
}

// ----- Helpers ------------------------------------------------------- //

// A fake Google token endpoint: trades a code for an (unsigned) ID token.
function startFakeGoogle()
{
  const server = http.createServer((req, res) =>
  {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () =>
    {
      const account = GOOGLE_ACCOUNTS[new URLSearchParams(body).get('code')]
      res.setHeader('Content-Type', 'application/json')
      if (req.url !== '/token' || !account)
      {
        res.statusCode = 400
        return res.end(JSON.stringify({ error: 'invalid_grant' }))
      }
      const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
      const claims = { aud: CLIENT_ID, email_verified: true, ...account }
      res.end(JSON.stringify({ id_token: `${part({ alg: 'none' })}.${part(claims)}.signature` }))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((done) => server.close(done)),
  })))
}

// The cookies a reply sets, as a Cookie header (cleared ones left out).
function cookiesFrom(reply)
{
  return reply.headers.getSetCookie()
    .map((line) => line.split(';')[0])
    .filter((pair) => !pair.endsWith('='))
    .join('; ')
}

// Whether a reply sets (not clears) the named cookie.
const setsCookie = (reply, name) => reply.headers.getSetCookie().some((line) => line.startsWith(`${name}=`) && !line.startsWith(`${name}=;`))

// The path and query of a redirect, for calling the server it points at.
function location(reply)
{
  assert.equal(reply.status, 302, `expected a redirect, got ${reply.status}`)
  return new URL(reply.headers.get('location'), 'http://placeholder')
}

/************************************************************************/
/*!
  \brief
    Walks a Google sign-in started on the team machine's website up to the
    VM's redirect back: the team machine's /auth/google, the VM's
    /auth/google, then Google answering the VM's callback with googleCode.
  \return
    { finish (the team machine's finish URL), localCookie, callback (the
    VM's reply) }
*/
/************************************************************************/
async function startOnTeamMachine(team, vm, googleCode, { googleError } = {})
{
  const start = await call(team.base, 'GET', '/api/v1/auth/google')
  const toVm = location(start)
  assert.equal(toVm.origin, new URL(vm.base).origin, 'the team machine sends the browser to the VM')
  assert.ok(toVm.searchParams.get('return_to'), 'the team machine asks to be returned to')
  const localCookie = cookiesFrom(start)

  const atVm = await call(vm.base, 'GET', `${toVm.pathname}${toVm.search}`)
  const googleState = location(atVm).searchParams.get('state')
  const vmCookies = cookiesFrom(atVm)
  assert.ok(setsCookie(atVm, 'genesis_google_return'), 'the VM keeps the allowed return address')

  const answer = googleError ? `error=${googleError}` : `code=${googleCode}`
  const callback = await call(vm.base, 'GET', `/auth/google/callback?${answer}&state=${googleState}`, { cookie: vmCookies })
  return { finish: location(callback), localCookie, callback }
}

// The full loop; returns the team machine's finish reply.
async function signInOnTeamMachine(team, vm, googleCode)
{
  const { finish, localCookie } = await startOnTeamMachine(team, vm, googleCode)
  return call(team.base, 'GET', `${finish.pathname}${finish.search}`, { cookie: localCookie })
}

// A Google sign-in started on the VM's own website (optionally with query
// parameters on /auth/google); returns the callback's reply.
async function signInOnVm(vm, googleCode, query = '')
{
  const start = await call(vm.base, 'GET', `/api/v1/auth/google${query}`)
  const state = location(start).searchParams.get('state')
  return { start, callback: await call(vm.base, 'GET', `/auth/google/callback?code=${googleCode}&state=${state}`, { cookie: cookiesFrom(start) }) }
}

// ----- Tests --------------------------------------------------------- //

describe('Google sign-in from a team machine ends on the team machine', () =>
{
  let google, vm, vmDir, team
  before(async () =>
  {
    google = await startFakeGoogle()
    vmDir = tempDir('google-vm')
    vm = await startServer(vmDir, {
      AUTH_MODE: 'authority',
      AUTH_API_KEY: KEY,
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: 'test-secret',
      GOOGLE_REDIRECT_URI: 'http://vm.test/auth/google/callback',
      GOOGLE_AUTH_URL: `${google.base}/auth`,
      GOOGLE_TOKEN_URL: `${google.base}/token`,
      GOOGLE_HANDOFF_TTL_SEC: String(HANDOFF_TTL_SEC),
    })
    team = await startServer(tempDir('google-team'), { AUTH_MODE: 'client', AUTH_API_KEY: KEY, VM_AUTH_URL: vm.base, AUTH_ALLOW_HTTP: '1' })
  })
  after(async () =>
  {
    await team?.stop()
    await vm?.stop()
    await google?.stop()
  })

  test('the team machine asks the VM to send the browser back to its own finish address', async () =>
  {
    const start = await call(team.base, 'GET', '/api/v1/auth/google')
    const toVm = location(start)
    assert.equal(toVm.pathname, '/auth/google')
    assert.equal(toVm.searchParams.get('return_to'), `${team.base}/api/v1/auth/google/finish`)
    assert.match(toVm.searchParams.get('return_state'), /^[\w-]{16,}$/)
    const localCookie = start.headers.getSetCookie().find((line) => line.startsWith('genesis_google_local='))
    assert.match(localCookie, /HttpOnly/i)
    assert.ok(localCookie.includes(`genesis_google_local=${toVm.searchParams.get('return_state')}`))
  })

  test('the full loop signs the browser in on the team machine, as the VM account', async () =>
  {
    const { finish, localCookie, callback } = await startOnTeamMachine(team, vm, 'code-alice')
    assert.ok(!setsCookie(callback, 'genesis_session'), 'the VM starts no session of its own')
    assert.equal(finish.pathname, '/api/v1/auth/google/finish')
    assert.ok(finish.searchParams.get('code'))

    const done = await call(team.base, 'GET', `${finish.pathname}${finish.search}`, { cookie: localCookie })
    assert.equal(location(done).pathname, '/')
    assert.equal(location(done).search, '')
    const session = sessionCookie(done)
    assert.ok(session, 'the team machine starts a session')

    const me = await call(team.base, 'GET', '/api/v1/auth/me', { cookie: session })
    assert.equal(me.status, 200)
    assert.equal(me.body.email, 'alice@example.com')
    assert.equal(me.body.role, 'user')
    const db = openDb(vmDir)
    try
    {
      const vmUser = db.prepare(`SELECT id, google_sub FROM users WHERE email = 'alice@example.com'`).get()
      assert.equal(vmUser.google_sub, 'google-alice', 'the account lives on the VM, linked to Google')
    }
    finally
    {
      db.close()
    }
  })

  test('the role comes from the VM', async () =>
  {
    const db = openDb(vmDir)
    db.prepare(`UPDATE users SET role = 'admin' WHERE email = 'alice@example.com'`).run()
    db.close()
    const done = await signInOnTeamMachine(team, vm, 'code-alice')
    const me = await call(team.base, 'GET', '/api/v1/auth/me', { cookie: sessionCookie(done) })
    assert.equal(me.body.role, 'admin')
  })

  test('the one-time code works once', async () =>
  {
    const { finish, localCookie } = await startOnTeamMachine(team, vm, 'code-bob')
    const code = finish.searchParams.get('code')
    const headers = { 'X-Auth-Key': KEY }
    const first = await call(vm.base, 'POST', '/api/v1/redeem-google-code', { headers, json: { code } })
    assert.equal(first.status, 200)
    assert.equal(first.body.email, 'bob@example.com')
    assert.deepEqual(Object.keys(first.body).sort(), ['email', 'id', 'name', 'role'])

    const again = await call(vm.base, 'POST', '/api/v1/redeem-google-code', { headers, json: { code } })
    assert.equal(again.status, 404)
    const done = await call(team.base, 'GET', `${finish.pathname}${finish.search}`, { cookie: localCookie })
    assert.equal(location(done).search, '?login=google_failed')
    assert.equal(sessionCookie(done), null)
  })

  test('the one-time code expires', async () =>
  {
    const { finish } = await startOnTeamMachine(team, vm, 'code-bob')
    await new Promise((resolve) => setTimeout(resolve, HANDOFF_TTL_SEC * 1000 + 500))
    const late = await call(vm.base, 'POST', '/api/v1/redeem-google-code', { headers: { 'X-Auth-Key': KEY }, json: { code: finish.searchParams.get('code') } })
    assert.equal(late.status, 404)
  })

  test('redeeming needs the shared key and a code', async () =>
  {
    assert.equal((await call(vm.base, 'POST', '/api/v1/redeem-google-code', { json: { code: 'x' } })).status, 401)
    assert.equal((await call(vm.base, 'POST', '/api/v1/redeem-google-code', { headers: { 'X-Auth-Key': KEY }, json: {} })).status, 400)
    assert.equal((await call(vm.base, 'POST', '/api/v1/redeem-google-code', { headers: { 'X-Auth-Key': KEY }, json: { code: 'made-up' } })).status, 404)
  })

  test('the finish link only works in the browser that started the sign-in', async () =>
  {
    const { finish, localCookie } = await startOnTeamMachine(team, vm, 'code-bob')
    // No cookie (another browser), and a different state.
    const noCookie = await call(team.base, 'GET', `${finish.pathname}${finish.search}`)
    assert.equal(location(noCookie).search, '?login=google_failed')
    const otherState = await call(team.base, 'GET', `${finish.pathname}${finish.search}`, { cookie: 'genesis_google_local=someone-elses-state-123' })
    assert.equal(location(otherState).search, '?login=google_failed')
    assert.equal(sessionCookie(noCookie) ?? sessionCookie(otherState), null)
    // The right browser still gets in: the code wasn't spent on the failures.
    const done = await call(team.base, 'GET', `${finish.pathname}${finish.search}`, { cookie: localCookie })
    assert.ok(sessionCookie(done))
  })

  test('a refusal at Google goes back to the team machine, which says so', async () =>
  {
    const { finish, localCookie, callback } = await startOnTeamMachine(team, vm, null, { googleError: 'access_denied' })
    assert.ok(!setsCookie(callback, 'genesis_session'))
    assert.equal(finish.searchParams.get('error'), 'google_denied')
    assert.equal(finish.searchParams.get('code'), null)
    const done = await call(team.base, 'GET', `${finish.pathname}${finish.search}`, { cookie: localCookie })
    assert.equal(location(done).search, '?login=google_denied')
  })

  test('a sign-in started on the VM\'s website still ends there', async () =>
  {
    const { start, callback } = await signInOnVm(vm, 'code-alice')
    assert.ok(start.headers.getSetCookie().some((line) => line.startsWith('genesis_google_return=;')), 'clears any earlier return address')
    assert.equal(location(callback).pathname, '/')
    assert.equal(location(callback).search, '')
    const me = await call(vm.base, 'GET', '/api/v1/auth/me', { cookie: sessionCookie(callback) })
    assert.equal(me.body.email, 'alice@example.com')
  })

  test('the VM never returns the browser to an address it doesn\'t allow', async () =>
  {
    const state = 'abcdefghijklmnop1234'
    const refused = [
      'https://evil.example/api/v1/auth/google/finish',
      'http://localhost:5005/somewhere-else',
      'http://localhost:5005/api/v1/auth/google/finish?next=https://evil.example',
      'http://localhost@evil.example/api/v1/auth/google/finish',
      'javascript:alert(1)//localhost/api/v1/auth/google/finish',
    ]
    for (const returnTo of refused)
    {
      const query = `?return_to=${encodeURIComponent(returnTo)}&return_state=${state}`
      const { start, callback } = await signInOnVm(vm, 'code-alice', query)
      assert.ok(!setsCookie(start, 'genesis_google_return'), `${returnTo} was accepted`)
      assert.equal(location(callback).origin, 'http://placeholder', `${returnTo}: the VM redirected off-site`)
      assert.equal(location(callback).pathname, '/')
      assert.ok(sessionCookie(callback), `${returnTo}: the sign-in should end on the VM`)
    }
  })
})

describe('Google sign-in on a machine that can\'t redeem codes', () =>
{
  let server
  before(async () =>
  {
    // Local mode with a VM address: no shared key, so no codes to redeem.
    server = await startServer(tempDir('google-local'), { VM_AUTH_URL: 'https://vm.example' })
  })
  after(() => server?.stop())

  test('sends the browser to the VM as before, without asking to come back', async () =>
  {
    const toVm = location(await call(server.base, 'GET', '/api/v1/auth/google'))
    assert.equal(toVm.href, 'https://vm.example/auth/google')
  })

  test('has no finish step', async () =>
  {
    const reply = await call(server.base, 'GET', '/api/v1/auth/google/finish?code=x&state=y')
    assert.equal(reply.status, 503)
    assert.equal(typeof reply.body.error, 'string')
  })
})
