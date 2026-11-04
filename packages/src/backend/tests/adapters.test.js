/*!************************************************************************
\file adapters.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Data adapters: the VM's replies (outside data) are checked and converted to
the common formats; JOB_SOURCES switches where jobs come from (this
machine's folders, sample data, both) with no other change; status.json
records of other versions are converted or refused.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import SwaggerParser from '@apidevtools/swagger-parser'
import Ajv2020 from 'ajv/dist/2020.js'
import { BACKEND_DIR, addJobFolder, call, openDb, sessionCookie, signUp, startServer, tempDir } from './helpers.js'

const JOB = 'aaaaaaaa-1111-2222-3333-444444444444'
const VM_JOB = 'bbbbbbbb-1111-2222-3333-444444444444'

// The JobSummary schema, as openapi.yaml publishes it.
const spec = await SwaggerParser.dereference(path.join(BACKEND_DIR, 'openapi.yaml'))
const strip = (s) => (Array.isArray(s) ? s.map(strip) : s && typeof s === 'object'
  ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== '$schema' && k !== '$id').map(([k, v]) => [k, strip(v)])) : s)
const checkJobList = new Ajv2020({ strict: false }).compile(strip(spec.paths['/jobs'].get.responses['200'].content['application/json'].schema))

// ----- Tests --------------------------------------------------------- //

describe('the VM adapter (a team machine reading the VM\'s replies)', () =>
{
  let fakeVm, client, cookie
  const vmJobs = [
    { id: VM_JOB, name: 'From the VM', status: 'done', phase: 'done', progress: 1, detail: null, error: null,
      createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-21 11:00:00', imageCount: 1, hasResult: true,
      thumbnail: `/api/v1/jobs/${VM_JOB}/images/0000.jpg`, cover: null,
      images: [{ name: '0000.jpg', url: `/api/v1/jobs/${VM_JOB}/images/0000.jpg`, extra: 'dropped' }],
      secretField: 'must not reach the browser' },
    { name: 'no id' },
    { id: '../../etc', status: 'done', createdAt: 1 },
    { id: 'cccccccc-1111-2222-3333-444444444444', status: 'weird', createdAt: 1 },
  ]
  before(async () =>
  {
    fakeVm = http.createServer((req, res) =>
    {
      const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
      if (req.headers['x-auth-key'] !== 'test-key') return send(401, { error: 'Unauthorized.' })
      if (req.url === '/api/v1/verify-account') return send(200, { valid: true, id: 7, email: 'admin@example.com', name: 'Admin', role: 'admin' })
      if (req.url === '/api/v1/library/jobs') return send(200, vmJobs)
      // An older VM sending ISO dates: still converted.
      if (req.url === '/api/v1/library/account') return send(200, { name: 'Admin', email: 'admin@example.com', role: 'admin', createdAt: '2026-10-04T08:15:00Z',
        memberSince: '4 October 2026', emailVerified: false, passwordChangedAt: '2026-10-22T09:30:00Z', signInMethods: { password: true, google: false }, photoVersion: null })
      if (req.url.startsWith('/api/v1/library/feedback')) return send(200, { items: [{ id: 9, name: 'A', email: 'a@example.com', category: 'idea', message: 'm', origin: null, createdAt: '2026-10-23T00:00:00Z' }], hasMore: false })
      send(404, { error: 'not found' })
    })
    await new Promise((resolve) => fakeVm.listen(0, '127.0.0.1', resolve))
    client = await startServer(tempDir('adapters-client'), {
      AUTH_MODE: 'client', AUTH_API_KEY: 'test-key', AUTH_ALLOW_HTTP: '1', VM_AUTH_URL: `http://127.0.0.1:${fakeVm.address().port}`,
    })
    const login = await call(client.base, 'POST', '/api/v1/auth/login', { json: { email: 'admin@example.com', password: 'whatever-the-vm-checks' } })
    assert.equal(login.status, 200)
    cookie = sessionCookie(login)
  })
  after(async () =>
  {
    await client.stop()
    fakeVm.close()
  })

  test('bad items are dropped, dates become ms, unknown fields go', async () =>
  {
    const jobs = (await call(client.base, 'GET', '/api/v1/jobs', { cookie })).body
    assert.deepEqual(jobs.map((j) => j.id), [VM_JOB])
    assert.equal(jobs[0].createdAt, Date.UTC(2026, 9, 20, 10))
    assert.equal(jobs[0].updatedAt, Date.UTC(2026, 9, 21, 11))
    assert.ok(!('secretField' in jobs[0]) && !('extra' in jobs[0].images[0]))
    assert.ok(checkJobList(jobs), JSON.stringify(checkJobList.errors))
    assert.match(client.log(), /ignored 3 job\(s\) from the VM/)
  })

  test('the VM\'s URLs get the version the browser asked for', async () =>
  {
    const v1 = (await call(client.base, 'GET', '/api/v1/jobs', { cookie })).body[0]
    const legacy = (await call(client.base, 'GET', '/jobs', { cookie })).body[0]
    assert.equal(v1.thumbnail, `/api/v1/jobs/${VM_JOB}/images/0000.jpg`)
    assert.equal(legacy.thumbnail, `/jobs/${VM_JOB}/images/0000.jpg`)
  })

  test('account and feedback from the VM: ms in v1, ISO on the legacy paths', async () =>
  {
    const v1 = (await call(client.base, 'GET', '/api/v1/auth/me/account', { cookie })).body
    assert.equal(v1.createdAt, Date.UTC(2026, 9, 4, 8, 15))
    assert.equal(v1.passwordChangedAt, Date.UTC(2026, 9, 22, 9, 30))
    const legacy = (await call(client.base, 'GET', '/auth/me/account', { cookie })).body
    assert.equal(legacy.passwordChangedAt, '2026-10-22T09:30:00Z')
    const feedback = (await call(client.base, 'GET', '/api/v1/feedback', { cookie })).body
    assert.equal(feedback.items[0].createdAt, Date.UTC(2026, 9, 23))
  })
})

describe('JOB_SOURCES switches the source, nothing else', () =>
{
  let dir, cookie
  before(async () =>
  {
    dir = tempDir('sources')
    const server = await startServer(dir)
    ;({ cookie } = await signUp(server.base, { email: 'erin@example.com' }))
    await server.stop()
    addJobFolder(dir, JOB, { createdAt: Date.UTC(2026, 10, 1) })
    const db = openDb(dir)
    db.prepare('INSERT INTO jobs (id, owner_id) SELECT ?, id FROM users').run(JOB)
    db.close()
  })
  const idsWith = async (sources) =>
  {
    const server = await startServer(dir, { JOB_SOURCES: sources })
    try
    {
      const jobs = (await call(server.base, 'GET', '/api/v1/jobs', { cookie })).body
      assert.ok(checkJobList(jobs), JSON.stringify(checkJobList.errors))
      return jobs.map((j) => j.id)
    }
    finally
    {
      await server.stop()
    }
  }

  test('live: this machine\'s jobs', async () =>
  {
    assert.deepEqual(await idsWith('live'), [JOB])
  })

  test('sample: the sample jobs only', async () =>
  {
    assert.deepEqual(await idsWith('sample'), ['sample-photo-set', 'sample-stonehenge', 'sample-cat-statue', 'sample-fox'])
  })

  test('live,sample: both, newest first', async () =>
  {
    assert.deepEqual(await idsWith('live,sample'), [JOB, 'sample-photo-set', 'sample-stonehenge', 'sample-cat-statue', 'sample-fox'])
  })

  test('sample jobs can be viewed but not changed', async () =>
  {
    const server = await startServer(dir, { JOB_SOURCES: 'sample' })
    try
    {
      assert.equal((await call(server.base, 'GET', '/api/v1/jobs/sample-fox', { cookie })).body.hasResult, true)
      const model = await call(server.base, 'GET', '/api/v1/jobs/sample-fox/result.ply', { cookie, headers: { Range: 'bytes=0-3' } })
      assert.equal(model.status, 206)
      assert.equal(model.body.toString(), 'ply\n')
      assert.equal((await call(server.base, 'GET', '/api/v1/jobs/sample-photo-set/images/0002.jpg', { cookie })).status, 200)
      assert.equal((await call(server.base, 'GET', '/api/v1/jobs/sample-photo-set/images/..%2F..%2Fpackage.json', { cookie })).status, 404)
      assert.equal((await call(server.base, 'PATCH', '/api/v1/jobs/sample-fox', { cookie, json: { name: 'Mine' } })).status, 404)
      assert.equal((await call(server.base, 'DELETE', '/api/v1/jobs/sample-fox/files', { cookie })).status, 404)
      assert.equal((await call(server.base, 'GET', '/api/v1/jobs/sample-fox')).status, 401)
    }
    finally
    {
      await server.stop()
    }
  })
})

describe('status.json versions', async () =>
{
  const dir = tempDir('status')
  process.env.ENV_FILE = path.join(dir, 'no-such.env')
  process.env.JOBS_DIR = dir
  const status = await import('../status.js')
  const write = (id, record) =>
  {
    fs.mkdirSync(path.join(dir, id), { recursive: true })
    fs.writeFileSync(path.join(dir, id, 'status.json'), JSON.stringify({ id, ...record }))
  }

  test('a version 1 record loads', async () =>
  {
    write('v1-job', { version: 1, status: 'done', createdAt: 1, updatedAt: 2, result: 'v1-job_out/result.ply', logTail: [] })
    assert.equal((await status.readStatus('v1-job', dir)).status, 'done')
  })

  test('a newer record is skipped, with one warning', async () =>
  {
    write('v2-job', { version: 2, status: 'done' })
    const warnings = []
    const warn = console.warn
    console.warn = (...a) => warnings.push(a.join(' '))
    try
    {
      assert.equal(await status.readStatus('v2-job', dir), null)
      await status.readStatus('v2-job', dir)
    }
    finally
    {
      console.warn = warn
    }
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /version 2, newer than this build/)
  })

  test('a record that breaks the schema is not trusted', async () =>
  {
    write('bad-job', { version: 1, status: 'done', progress: 7 })
    assert.equal(await status.readStatus('bad-job', dir), null)
  })

  test('an older record loads once a converter exists', async () =>
  {
    write('v0-job', { version: 0, state: 'finished' })
    assert.equal(await status.readStatus('v0-job', dir), null)
    status.STATUS_UPGRADES[0] = (old) => ({ ...old, version: 1, status: old.state === 'finished' ? 'done' : 'error' })
    try
    {
      assert.equal((await status.readStatus('v0-job', dir)).status, 'done')
    }
    finally
    {
      delete status.STATUS_UPGRADES[0]
    }
  })
})
