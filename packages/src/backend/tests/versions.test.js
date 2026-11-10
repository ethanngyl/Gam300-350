/*!************************************************************************
\file versions.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
API versions (docs/api-changelog.md): v1 sends dates as milliseconds and
its own URLs; the legacy unversioned paths answer exactly as before but are
marked deprecated; unknown versions are 404. The catalog (reference data)
is served from catalog/catalog.json, and a broken catalog or JOB_SOURCES
stops startup.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { BACKEND_DIR, addJobFolder, call, openDb, signUp, startServer, tempDir } from './helpers.js'

const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/
const JOB = 'aaaaaaaa-1111-2222-3333-444444444444'
const CATALOG = JSON.parse(fs.readFileSync(path.join(BACKEND_DIR, 'catalog', 'catalog.json'), 'utf8'))

// ----- Tests --------------------------------------------------------- //

describe('v1 and the legacy paths', () =>
{
  let dir, server, cookie
  before(async () =>
  {
    dir = tempDir('versions')
    server = await startServer(dir)
    ;({ cookie } = await signUp(server.base, { email: 'admin@example.com', name: 'Admin' }))
    addJobFolder(dir, JOB)
    const db = openDb(dir)
    db.prepare(`UPDATE users SET role = 'admin', created_at = ? WHERE email = 'admin@example.com'`).run(Date.UTC(2026, 9, 4, 8, 15, 0))
    db.prepare('INSERT INTO jobs (id, owner_id) SELECT ?, id FROM users').run(JOB)
    db.close()
    await call(server.base, 'POST', '/api/v1/feedback', { cookie, json: { category: 'bug', message: 'A bug report for the test.' } })
  })
  after(() => server.stop())

  test('users: v1 milliseconds, legacy ISO text', async () =>
  {
    const v1 = await call(server.base, 'GET', '/api/v1/auth/me', { cookie })
    assert.equal(v1.body.createdAt, Date.UTC(2026, 9, 4, 8, 15, 0))
    assert.equal(v1.body.memberSince, '4 October 2026')
    const legacy = await call(server.base, 'GET', '/auth/me', { cookie })
    assert.equal(legacy.body.createdAt, '2026-10-04T08:15:00Z')
  })

  test('account details: only the dates differ', async () =>
  {
    const v1 = (await call(server.base, 'GET', '/api/v1/auth/me/account', { cookie })).body
    const legacy = (await call(server.base, 'GET', '/auth/me/account', { cookie })).body
    assert.equal(typeof v1.createdAt, 'number')
    assert.match(legacy.createdAt, ISO_RE)
    assert.deepEqual({ ...v1, createdAt: 0 }, { ...legacy, createdAt: 0 })
  })

  test('feedback: v1 milliseconds, legacy ISO to the second', async () =>
  {
    const v1 = (await call(server.base, 'GET', '/api/v1/feedback', { cookie })).body.items[0]
    const legacy = (await call(server.base, 'GET', '/feedback', { cookie })).body.items[0]
    assert.equal(typeof v1.createdAt, 'number')
    assert.match(legacy.createdAt, ISO_RE)
    assert.equal(Date.parse(legacy.createdAt), Math.floor(v1.createdAt / 1000) * 1000)
  })

  test('job URLs follow the version asked for', async () =>
  {
    const v1 = (await call(server.base, 'GET', '/api/v1/jobs', { cookie })).body.find((j) => j.id === JOB)
    assert.equal(v1.thumbnail, `/api/v1/jobs/${JOB}/images/0000.jpg`)
    const legacy = (await call(server.base, 'GET', '/jobs', { cookie })).body.find((j) => j.id === JOB)
    assert.equal(legacy.thumbnail, `/jobs/${JOB}/images/0000.jpg`)
    const photo = await call(server.base, 'GET', v1.thumbnail, { cookie })
    assert.equal(photo.status, 200)
    assert.equal(photo.type, 'image/jpeg')
  })

  test('legacy replies are marked deprecated, with the v1 successor', async () =>
  {
    const legacy = await call(server.base, 'GET', '/auth/me', { cookie })
    assert.equal(legacy.headers.get('deprecation'), `@${Date.UTC(2026, 10, 3) / 1000}`)
    assert.equal(legacy.headers.get('link'), '</api/v1/auth/me>; rel="successor-version"')
    const v1 = await call(server.base, 'GET', '/api/v1/auth/me', { cookie })
    assert.equal(v1.headers.get('deprecation'), null)
    const v1Missing = await call(server.base, 'GET', '/api/v1/no-such-route', { cookie })
    assert.equal(v1Missing.status, 404)
    assert.equal(v1Missing.headers.get('deprecation'), null)
  })

  test('video upload limits give the video message on both paths', async () =>
  {
    for (const urlPath of ['/api/v1/jobs/from-media', '/jobs/from-media'])
    {
      const form = new FormData()
      for (let i = 0; i < 11; i++) form.append('media', new Blob(['not really a video']), `clip-${i}.mp4`)
      const reply = await call(server.base, 'POST', urlPath, { cookie, body: form })
      assert.equal(reply.status, 400, urlPath)
      assert.equal(reply.body.error, 'Too many files -- upload at most 10 files at once.', urlPath)
    }
  })

  test('an unknown version or path is a JSON 404', async () =>
  {
    for (const urlPath of ['/api/v2/jobs', '/wiki', '/no/such/path'])
    {
      const reply = await call(server.base, 'GET', urlPath, { cookie })
      assert.equal(reply.status, 404, urlPath)
      assert.equal(typeof reply.body.error, 'string', urlPath)
    }
  })

  test('the catalog is catalog.json plus the limits from config', async () =>
  {
    const reply = await call(server.base, 'GET', '/api/v1/catalog')
    assert.equal(reply.status, 200)
    const { limits, ...rest } = reply.body
    assert.deepEqual(rest, CATALOG)
    assert.equal(limits.maxPhotos, 300)
    assert.equal(limits.maxMediaFiles, 10)
  })

  test('feedback categories come from the catalog', async () =>
  {
    const reply = await call(server.base, 'POST', '/api/v1/feedback', { cookie, json: { category: 'praise', message: 'Not a category in the catalog.' } })
    assert.equal(reply.status, 400)
    assert.equal(reply.body.error, 'Choose a feedback type: bug report, idea or other.')
  })
})

describe('settings that stop startup', () =>
{
  test('a broken catalog, naming the problems', async () =>
  {
    const dir = tempDir('broken-catalog')
    const file = path.join(dir, 'catalog.json')
    fs.writeFileSync(file, JSON.stringify({ ...CATALOG, defaultTrainingPreset: 'turbo', trainingPresets: [{ id: 'fast', label: 'Fast', iterations: 999999 }] }))
    const server = await startServer(dir, { CATALOG_FILE: file })
    await server.exited
    assert.notEqual(server.exitCode, 0)
    assert.match(server.log(), /training preset "fast" is outside 1000-30000 iterations/)
    assert.match(server.log(), /defaultTrainingPreset "turbo"/)
  })

  test('a typo in JOB_SOURCES', async () =>
  {
    const server = await startServer(tempDir('bad-sources'), { JOB_SOURCES: 'live,smaple' })
    await server.exited
    assert.notEqual(server.exitCode, 0)
    assert.match(server.log(), /JOB_SOURCES/)
  })
})
