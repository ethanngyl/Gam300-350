/*!************************************************************************
\file ratelimit.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-11-2026
\brief
Tests for the rate limits (ratelimit.js, middleware/limits.js): the limiter
itself, the wait messages, the general API limit (per user / per address,
team-machine calls not counted, 0 = off), the per-user build limit (only
accepted builds count, admins exempt) and the model download limit (only
full downloads count).
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLimiter } from '../ratelimit.js'
import { tooManyAttempts, waitText } from '../middleware/limits.js'
import { SAMPLE_PHOTO, addJobFolder, call, openDb, signUp, startServer, tempDir } from './helpers.js'

const KEY = 'test-shared-key-0123456789'
const PHOTO = fs.readFileSync(SAMPLE_PHOTO)

// A photo upload of `count` copies of the sample photo.
function photoForm(count)
{
  const form = new FormData()
  for (let i = 0; i < count; i++) form.append('images', new Blob([PHOTO], { type: 'image/jpeg' }), `${String(i).padStart(4, '0')}.jpg`)
  return form
}

// A different made-up address for each caller (the servers run with TRUST_PROXY=true).
let nextIp = 1
const freshIp = () => ({ 'X-Forwarded-For': `203.0.113.${nextIp++}` })

// ----- Tests --------------------------------------------------------- //

describe('createLimiter', () =>
{
  test('allows max events, then blocks until the window ends', () =>
  {
    const limiter = createLimiter({ windowMs: 60_000, max: 3 })
    for (let i = 0; i < 3; i++) assert.equal(limiter.hit('a').allowed, true)
    const blocked = limiter.hit('a')
    assert.equal(blocked.allowed, false)
    assert.ok(blocked.retryAfterSec > 0 && blocked.retryAfterSec <= 60, `retryAfterSec ${blocked.retryAfterSec}`)
    assert.equal(limiter.hit('b').allowed, true, 'keys are counted separately')
  })

  test('check does not count, and reset clears the key', () =>
  {
    const limiter = createLimiter({ windowMs: 60_000, max: 1 })
    for (let i = 0; i < 5; i++) assert.equal(limiter.check('a').allowed, true)
    limiter.hit('a')
    assert.equal(limiter.check('a').allowed, false)
    limiter.reset('a')
    assert.equal(limiter.check('a').allowed, true)
  })

  test('max 0 switches the limiter off', () =>
  {
    const limiter = createLimiter({ windowMs: 60_000, max: 0 })
    for (let i = 0; i < 100; i++) assert.equal(limiter.hit('a').allowed, true)
    assert.equal(limiter.check('a').allowed, true)
  })
})

describe('wait messages', () =>
{
  test('minutes up to 90, then hours', () =>
  {
    assert.equal(waitText(5), '1 minute')
    assert.equal(waitText(14 * 60), '14 minutes')
    assert.equal(waitText(90 * 60), '90 minutes')
    assert.equal(waitText(150 * 60), '3 hours')
    assert.equal(tooManyAttempts(60), 'Too many attempts. Try again in 1 minute.')
    assert.equal(tooManyAttempts(120, 'requests'), 'Too many requests. Try again in 2 minutes.')
  })
})

describe('general API limit', () =>
{
  let dir, server
  before(async () =>
  {
    dir = tempDir('ratelimit-api')
    server = await startServer(dir, { RATE_LIMIT_API_PER_MIN: '5', TRUST_PROXY: 'true', AUTH_MODE: 'authority', AUTH_API_KEY: KEY })
  })
  after(() => server.stop())

  test('a guest gets 429 with Retry-After after the limit', async () =>
  {
    const headers = freshIp()
    for (let i = 0; i < 5; i++) assert.equal((await call(server.base, 'GET', '/api/v1/catalog', { headers })).status, 200)
    const over = await call(server.base, 'GET', '/api/v1/catalog', { headers })
    assert.equal(over.status, 429)
    assert.ok(Number(over.headers.get('retry-after')) > 0)
    assert.ok(over.body.retryAfterSec > 0)
    assert.match(over.body.error, /^Too many requests\. Try again in \d+ minutes?\.$/)
    // The same path without /api/v1 shares the allowance.
    assert.equal((await call(server.base, 'GET', '/catalog', { headers })).status, 429)
  })

  test('a signed-in user has their own allowance, separate from the address', async () =>
  {
    const headers = freshIp()
    const { cookie } = await signUp(server.base, { email: 'alice@example.com' }) // from 127.0.0.1
    for (let i = 0; i < 5; i++) await call(server.base, 'GET', '/api/v1/catalog', { headers })
    assert.equal((await call(server.base, 'GET', '/api/v1/catalog', { headers })).status, 429, 'the address is used up')
    assert.equal((await call(server.base, 'GET', '/api/v1/catalog', { headers, cookie })).status, 200, 'the user is not')
  })

  test('team-machine calls with the shared key are not counted', async () =>
  {
    const db = openDb(dir)
    const { id } = db.prepare(`SELECT id FROM users WHERE email = 'alice@example.com'`).get()
    db.close()
    const headers = { ...freshIp(), 'X-Auth-Key': KEY, 'X-Act-As-User': String(id) }
    for (let i = 0; i < 12; i++)
    {
      const reply = await call(server.base, 'GET', '/api/v1/library/jobs', { headers })
      assert.equal(reply.status, 200, `call ${i + 1}: ${JSON.stringify(reply.body)}`)
    }
  })

  test('an unknown path is counted once', async () =>
  {
    // It goes through the API router twice (/api/v1, then the legacy paths).
    const headers = freshIp()
    for (let i = 0; i < 5; i++) assert.equal((await call(server.base, 'GET', '/api/v1/no-such-route', { headers })).status, 404)
    assert.equal((await call(server.base, 'GET', '/api/v1/no-such-route', { headers })).status, 429)
  })
})

describe('general API limit switched off', () =>
{
  let server
  before(async () => { server = await startServer(tempDir('ratelimit-off'), { RATE_LIMIT_API_PER_MIN: '0' }) })
  after(() => server.stop())

  test('0 means no limit', async () =>
  {
    for (let i = 0; i < 20; i++) assert.equal((await call(server.base, 'GET', '/api/v1/catalog')).status, 200)
  })
})

describe('build limit', () =>
{
  let dir, server
  before(async () =>
  {
    dir = tempDir('ratelimit-builds')
    server = await startServer(dir, { RATE_LIMIT_BUILDS_PER_HOUR: '2', TRUST_PROXY: 'true' })
  })
  after(() => server.stop())

  test('only accepted builds count, and the next one gets 429', { timeout: 60_000 }, async () =>
  {
    const { cookie } = await signUp(server.base, { email: 'bob@example.com' })
    const tooFew = await call(server.base, 'POST', '/api/v1/upload', { cookie, body: photoForm(2) })
    assert.equal(tooFew.status, 400, 'too few photos is rejected, and not counted')

    for (let i = 0; i < 2; i++)
    {
      const reply = await call(server.base, 'POST', '/api/v1/upload', { cookie, body: photoForm(8) })
      assert.equal(reply.status, 202, JSON.stringify(reply.body))
    }
    const over = await call(server.base, 'POST', '/api/v1/upload', { cookie, body: photoForm(8) })
    assert.equal(over.status, 429)
    assert.ok(Number(over.headers.get('retry-after')) > 0)
    assert.match(over.body.error, /^You've started too many builds\. Try again in \d+ minutes?\.$/)

    // Videos share the same allowance.
    const media = new FormData()
    media.append('media', new Blob(['not really a video']), 'clip.mp4')
    assert.equal((await call(server.base, 'POST', '/api/v1/jobs/from-media', { cookie, body: media })).status, 429)
  })

  test('admins are exempt', { timeout: 60_000 }, async () =>
  {
    const { cookie } = await signUp(server.base, { email: 'admin@example.com' })
    const db = openDb(dir)
    db.prepare(`UPDATE users SET role = 'admin' WHERE email = 'admin@example.com'`).run()
    db.close()
    for (let i = 0; i < 3; i++)
    {
      const reply = await call(server.base, 'POST', '/api/v1/upload', { cookie, body: photoForm(8) })
      assert.equal(reply.status, 202, `build ${i + 1}: ${JSON.stringify(reply.body)}`)
    }
  })
})

describe('download limit', () =>
{
  let dir, server
  const JOB = 'ratelimit-model'
  before(async () =>
  {
    dir = tempDir('ratelimit-downloads')
    addJobFolder(dir, JOB, { status: 'done', error: null, result: `${JOB}_out/result.ply` })
    fs.mkdirSync(path.join(dir, 'jobs', `${JOB}_out`), { recursive: true })
    fs.writeFileSync(path.join(dir, 'jobs', `${JOB}_out`, 'result.ply'), Buffer.alloc(64 * 1024, 1))
    server = await startServer(dir, { RATE_LIMIT_DOWNLOADS_PER_HOUR: '1' })
  })
  after(() => server.stop())

  test('only full downloads count', async () =>
  {
    const email = 'carol@example.com'
    const { cookie } = await signUp(server.base, { email })
    const db = openDb(dir)
    db.prepare('INSERT INTO jobs (id, owner_id) SELECT ?, id FROM users WHERE email = ?').run(JOB, email)
    db.close()
    const url = `/api/v1/jobs/${JOB}/result.ply`

    const range = await call(server.base, 'GET', url, { cookie, headers: { Range: 'bytes=0-4095' } })
    assert.equal(range.status, 206, 'a range read (the website reading the header) is not counted')
    assert.equal((await call(server.base, 'HEAD', url, { cookie })).status, 200, 'HEAD is not counted')
    assert.equal((await call(server.base, 'GET', url, { cookie })).status, 200)
    const over = await call(server.base, 'GET', url, { cookie })
    assert.equal(over.status, 429)
    assert.match(over.body.error, /^You've downloaded too many models\. Try again in \d+ minutes?\.$/)
  })
})
