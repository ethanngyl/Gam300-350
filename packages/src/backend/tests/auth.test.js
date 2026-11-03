/*!************************************************************************
\file auth.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Authentication: sign-up and sign-in, every protected endpoint (from
openapi.yaml) refusing a request without a session, passwords and session
tokens stored only as hashes, sign-out, admin-only routes, the shared key
on the VM's machine-to-machine routes, and the login limits.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import assert from 'node:assert/strict'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import SwaggerParser from '@apidevtools/swagger-parser'
import { BACKEND_DIR, call, openDb, sessionCookie, signUp, startServer, tempDir } from './helpers.js'

const PASSWORD = 'correct-horse-battery'
const spec = await SwaggerParser.dereference(path.join(BACKEND_DIR, 'openapi.yaml'))

// Every documented operation, with its path parameters filled in from their examples.
function operations(securityName)
{
  const list = []
  for (const [template, item] of Object.entries(spec.paths))
  {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'])
    {
      const op = item[method]
      if (!op || !op.security?.some((scheme) => securityName in scheme)) continue
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])]
      const urlPath = template.replace(/\{(\w+)\}/g, (_m, name) => params.find((p) => p.name === name && p.in === 'path').example)
      list.push({ method: method.toUpperCase(), template, urlPath })
    }
  }
  return list
}

// ----- Tests --------------------------------------------------------- //

describe('sign-up, sign-in and protected endpoints', () =>
{
  let dir, server, cookie
  before(async () =>
  {
    dir = tempDir('auth')
    server = await startServer(dir)
    ;({ cookie } = await signUp(server.base, { email: 'alice@example.com', name: 'Alice', password: PASSWORD }))
  })
  after(() => server.stop())

  test('sign-up sets an HttpOnly session cookie', async () =>
  {
    const reply = await call(server.base, 'POST', '/api/v1/auth/signup', { json: { name: 'Bob', email: 'bob@example.com', password: PASSWORD } })
    assert.equal(reply.status, 201)
    const setCookie = reply.headers.get('set-cookie')
    assert.match(setCookie, /genesis_session=[^;]+/)
    assert.match(setCookie, /HttpOnly/i)
    assert.match(setCookie, /SameSite=Lax/i)
    assert.equal(reply.body.email, 'bob@example.com')
    assert.ok(!('password' in reply.body) && !JSON.stringify(reply.body).includes(PASSWORD))
  })

  test('login: wrong password and unknown email get the same 401, the right password a session', async () =>
  {
    const wrong = await call(server.base, 'POST', '/api/v1/auth/login', { json: { email: 'alice@example.com', password: 'not-the-password' } })
    const unknown = await call(server.base, 'POST', '/api/v1/auth/login', { json: { email: 'nobody@example.com', password: PASSWORD } })
    assert.equal(wrong.status, 401)
    assert.deepEqual(wrong.body, unknown.body)
    const right = await call(server.base, 'POST', '/api/v1/auth/login', { json: { email: 'alice@example.com', password: PASSWORD } })
    assert.equal(right.status, 200)
    const me = await call(server.base, 'GET', '/api/v1/auth/me', { cookie: sessionCookie(right) })
    assert.equal(me.status, 200)
    assert.equal(me.body.name, 'Alice')
  })

  test('every endpoint that needs a session answers 401 without one', async () =>
  {
    const protectedOps = operations('sessionCookie')
    assert.ok(protectedOps.length >= 25, `only ${protectedOps.length} protected operations documented`)
    for (const op of protectedOps)
    {
      const reply = await call(server.base, op.method, `/api/v1${op.urlPath}`)
      assert.equal(reply.status, 401, `${op.method} ${op.template} without a session gave ${reply.status}`)
      assert.equal(typeof reply.body.error, 'string', `${op.method} ${op.template}: no JSON error`)
    }
  })

  test('...and lets a signed-in user through', async () =>
  {
    for (const op of operations('sessionCookie').filter((o) => o.method === 'GET'))
    {
      const reply = await call(server.base, op.method, `/api/v1${op.urlPath}`, { cookie })
      assert.notEqual(reply.status, 401, `${op.method} ${op.template} with a session gave 401`)
    }
  })

  test('a made-up session token is refused', async () =>
  {
    const reply = await call(server.base, 'GET', '/api/v1/auth/me', { cookie: 'genesis_session=forged-token-value' })
    assert.equal(reply.status, 401)
  })

  test('passwords and session tokens are stored only as hashes', () =>
  {
    const db = openDb(dir)
    try
    {
      for (const row of db.prepare(`SELECT email, password_hash FROM users`).all())
      {
        assert.match(row.password_hash, /^[0-9a-f]{32}:[0-9a-f]{128}$/, `${row.email}: not a salt:scrypt hash`)
        assert.ok(!row.password_hash.includes(PASSWORD))
      }
      const token = cookie.split('=')[1]
      const sessions = db.prepare('SELECT token_hash FROM sessions').all()
      assert.ok(sessions.length > 0)
      for (const { token_hash: hash } of sessions)
      {
        assert.match(hash, /^[0-9a-f]{64}$/)
        assert.notEqual(hash, token)
      }
    }
    finally
    {
      db.close()
    }
  })

  test('only admins can read the feedback inbox', async () =>
  {
    assert.equal((await call(server.base, 'GET', '/api/v1/feedback', { cookie })).status, 403)
    const db = openDb(dir)
    db.prepare(`UPDATE users SET role = 'admin' WHERE email = 'alice@example.com'`).run()
    db.close()
    assert.equal((await call(server.base, 'GET', '/api/v1/feedback', { cookie })).status, 200)
  })

  test('logout ends the session', async () =>
  {
    const login = await call(server.base, 'POST', '/api/v1/auth/login', { json: { email: 'alice@example.com', password: PASSWORD } })
    const session = sessionCookie(login)
    assert.equal((await call(server.base, 'POST', '/api/v1/auth/logout', { cookie: session })).status, 204)
    assert.equal((await call(server.base, 'GET', '/api/v1/auth/me', { cookie: session })).status, 401)
  })
})

describe('the VM\'s machine-to-machine routes need the shared key', () =>
{
  const KEY = 'test-shared-key-0123456789'
  let server, userId
  before(async () =>
  {
    server = await startServer(tempDir('auth-vm'), { AUTH_MODE: 'authority', AUTH_API_KEY: KEY })
    const reply = await call(server.base, 'POST', '/api/v1/register', { headers: { 'X-Auth-Key': KEY }, json: { name: 'Carol', email: 'carol@example.com', password: PASSWORD } })
    assert.equal(reply.status, 201)
    userId = reply.body.id
  })
  after(() => server.stop())

  test('every key-protected endpoint refuses a missing or wrong key', async () =>
  {
    const keyOps = operations('authorityKey')
    assert.ok(keyOps.length >= 20, `only ${keyOps.length} key-protected operations documented`)
    for (const op of keyOps)
    {
      for (const headers of [{}, { 'X-Auth-Key': 'wrong-key' }, { 'X-Auth-Key': `${KEY}x` }])
      {
        const reply = await call(server.base, op.method, `/api/v1${op.urlPath}`, { headers: { ...headers, 'X-Act-As-User': String(userId) } })
        assert.equal(reply.status, 401, `${op.method} ${op.template} with ${JSON.stringify(headers)} gave ${reply.status}`)
      }
    }
  })

  test('the right key works, and the role comes from the VM\'s own database', async () =>
  {
    const ok = await call(server.base, 'GET', '/api/v1/library/account', { headers: { 'X-Auth-Key': KEY, 'X-Act-As-User': String(userId) } })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.role, 'user')
    const inbox = await call(server.base, 'GET', '/api/v1/library/feedback', { headers: { 'X-Auth-Key': KEY, 'X-Act-As-User': String(userId) } })
    assert.equal(inbox.status, 403)
    const nobody = await call(server.base, 'GET', '/api/v1/library/account', { headers: { 'X-Auth-Key': KEY, 'X-Act-As-User': '99999' } })
    assert.equal(nobody.status, 401)
  })

  test('verify-account: right and wrong passwords', async () =>
  {
    const headers = { 'X-Auth-Key': KEY }
    const right = await call(server.base, 'POST', '/api/v1/verify-account', { headers, json: { email: 'carol@example.com', password: PASSWORD } })
    assert.deepEqual(right.body, { valid: true, id: userId, email: 'carol@example.com', name: 'Carol', role: 'user' })
    const wrong = await call(server.base, 'POST', '/api/v1/verify-account', { headers, json: { email: 'carol@example.com', password: 'nope-nope' } })
    assert.deepEqual(wrong.body, { valid: false })
  })
})

describe('login limits', () =>
{
  let server
  before(async () =>
  {
    server = await startServer(tempDir('auth-limits'))
    await signUp(server.base, { email: 'dave@example.com', password: PASSWORD })
  })
  after(() => server.stop())

  test('10 wrong passwords lock the email, even for the right password (429)', async () =>
  {
    for (let i = 0; i < 10; i++)
    {
      const reply = await call(server.base, 'POST', '/api/v1/auth/login', { json: { email: 'dave@example.com', password: `wrong-${i}` } })
      assert.equal(reply.status, 401)
    }
    const locked = await call(server.base, 'POST', '/api/v1/auth/login', { json: { email: 'dave@example.com', password: PASSWORD } })
    assert.equal(locked.status, 429)
    assert.ok(Number(locked.headers.get('retry-after')) > 0)
  })
})
