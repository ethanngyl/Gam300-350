/*!************************************************************************
\file performance.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 07-11-2026
\brief
Performance measurements (services/performance.js, middleware/timing.js,
routes/metrics.js): the histogram and percentile maths, API calls counted
under their routes, page-load reports, who may read the report, and the
numbers surviving a restart and being deleted after PERF_KEEP_DAYS.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import assert from 'node:assert/strict'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { addJobFolder, call, openDb, signUp, startServer, tempDir } from './helpers.js'

// performance.js opens the database through db.js: point it at a temp folder
// (and no .env) before loading it.
const unitDir = tempDir('perf-unit')
process.env.ENV_FILE = path.join(unitDir, 'no-such.env')
process.env.DATA_DIR = path.join(unitDir, 'data')
process.env.JOBS_DIR = path.join(unitDir, 'jobs')
const perf = await import('../services/performance.js')

const JOB = 'aaaaaaaa-1111-2222-3333-444444444444'
const DAY_MS = 24 * 60 * 60 * 1000

// A histogram of the given times, as recordTiming would build it.
function histogramOf(times)
{
  const buckets = new Array(perf.BUCKET_EDGES_MS.length + 1).fill(0)
  for (const ms of times) buckets[perf.bucketIndex(ms)]++
  return buckets
}

// ----- Tests --------------------------------------------------------- //

describe('histogram and percentiles', () =>
{
  // This process's own database connection (opened by db.js), so its temp
  // folder can be deleted afterwards.
  after(async () => (await import('../db.js')).db.close())

  test('each time lands in its range, the slowest past the last edge', () =>
  {
    assert.equal(perf.bucketIndex(0.4), 0)
    assert.equal(perf.bucketIndex(1), 0)
    assert.equal(perf.bucketIndex(1.01), 1)
    assert.equal(perf.bucketIndex(60000), perf.BUCKET_EDGES_MS.length - 1)
    assert.equal(perf.bucketIndex(90000), perf.BUCKET_EDGES_MS.length)
  })

  test('percentiles of 1..1000 ms spread evenly', () =>
  {
    const buckets = histogramOf(Array.from({ length: 1000 }, (_v, i) => i + 1))
    assert.equal(perf.percentile(buckets, 50, 1000), 500)
    assert.equal(perf.percentile(buckets, 95, 1000), 950)
    assert.equal(perf.percentile(buckets, 99, 1000), 990)
  })

  test('a percentile is never above the slowest time, and empty means null', () =>
  {
    assert.ok(perf.percentile(histogramOf([3.2, 3.2, 3.2]), 95, 3.2) <= 3.2)
    assert.ok(perf.percentile(histogramOf([120000]), 99, 120000) <= 120000)
    assert.equal(perf.percentile(histogramOf([]), 95, 0), null)
  })
})

describe('the server measures itself', () =>
{
  let dir, server, admin, user
  const report = async (window = '1h') => (await call(server.base, 'GET', `/api/v1/metrics/performance?window=${window}`, { cookie: admin })).body
  const route = (body, name) => body.api.find((entry) => entry.route === name)

  before(async () =>
  {
    dir = tempDir('perf')
    server = await startServer(dir, { PERF_FLUSH_SEC: '1' })
    admin = (await signUp(server.base, { email: 'admin@example.com' })).cookie
    user = (await signUp(server.base, { email: 'user@example.com' })).cookie
    addJobFolder(dir, JOB)
    const db = openDb(dir)
    db.prepare(`UPDATE users SET role = 'admin' WHERE email = 'admin@example.com'`).run()
    db.prepare(`INSERT INTO jobs (id, owner_id) SELECT ?, id FROM users WHERE email = 'admin@example.com'`).run(JOB)
    db.close()
  })
  after(() => server.stop())

  test('API calls are counted under their route, the same for /api/v1 and legacy paths', async () =>
  {
    // startServer's readiness check has already called GET /catalog.
    const catalogBefore = route(await report(), 'GET /catalog')?.count ?? 0
    for (let i = 0; i < 3; i++) await call(server.base, 'GET', '/api/v1/catalog')
    await call(server.base, 'GET', '/catalog')
    await call(server.base, 'GET', `/api/v1/jobs/${JOB}`, { cookie: admin })
    await call(server.base, 'GET', `/jobs/${JOB}`, { cookie: admin })
    await call(server.base, 'GET', '/api/v1/no/such/path')
    await call(server.base, 'GET', '/made-up-page-1')

    const body = await report()
    assert.equal(route(body, 'GET /catalog').count - catalogBefore, 4)
    assert.equal(route(body, 'GET /jobs/:id').count, 2)
    assert.equal(route(body, '(no route)').count, 2)
    assert.ok(!body.api.some((entry) => entry.route.includes('made-up') || entry.route.includes('no/such')), 'made-up paths must not become route names')
    for (const entry of body.api)
    {
      assert.ok(entry.p50 <= entry.p95 && entry.p95 <= entry.p99 && entry.p99 <= entry.max, JSON.stringify(entry))
      assert.equal(entry.errors, 0)
    }
    const p95s = body.api.map((entry) => entry.p95)
    assert.deepEqual(p95s, [...p95s].sort((a, b) => b - a), 'slowest p95 first')
  })

  test('a /library call is not counted as the plain route', async () =>
  {
    // Not the VM: the shared-key check answers 503 before any route matches.
    await call(server.base, 'GET', `/api/v1/library/jobs/${JOB}`)
    assert.equal(route(await report(), 'GET /jobs/:id').count, 2)
  })

  test('page-load reports', async () =>
  {
    let reply = await call(server.base, 'POST', '/api/v1/metrics/page-load', { json: { ttfb: 40, fcp: 300, domContentLoaded: 280, load: 650, extra: 'ignored' } })
    assert.equal(reply.status, 204)
    await call(server.base, 'POST', '/api/v1/metrics/page-load', { json: { load: 900 } })
    const pageLoad = (await report()).pageLoad
    assert.deepEqual(pageLoad.map((entry) => entry.metric), ['ttfb', 'fcp', 'domContentLoaded', 'load'])
    const load = pageLoad.find((entry) => entry.metric === 'load')
    assert.equal(load.count, 2)
    assert.equal(load.max, 900)
    assert.equal(load.mean, 775)

    for (const bad of [{}, { load: -1 }, { load: 999999 }, { load: '650' }, [1, 2]])
    {
      reply = await call(server.base, 'POST', '/api/v1/metrics/page-load', { json: bad })
      assert.equal(reply.status, 400, JSON.stringify(bad))
    }
  })

  test('page-load reports are limited per IP address', async () =>
  {
    let status = 0
    for (let i = 0; i < 35 && status !== 429; i++)
      status = (await call(server.base, 'POST', '/api/v1/metrics/page-load', { json: { load: 500 } })).status
    assert.equal(status, 429)
  })

  test('only admins can read the report', async () =>
  {
    assert.equal((await call(server.base, 'GET', '/api/v1/metrics/performance')).status, 401)
    assert.equal((await call(server.base, 'GET', '/api/v1/metrics/performance', { cookie: user })).status, 403)
    assert.equal((await call(server.base, 'GET', '/api/v1/metrics/performance?window=bogus', { cookie: admin })).status, 400)
    const body = await report('7d')
    assert.equal(body.window, '7d')
    assert.ok(body.to - body.from === 7 * DAY_MS)
  })

  test('the numbers survive a restart, and old ones are deleted', async () =>
  {
    const catalogBefore = route(await report(), 'GET /catalog').count
    // Written to the database every second (PERF_FLUSH_SEC=1).
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const db = openDb(dir)
    const old = Math.floor((Date.now() - 8 * DAY_MS) / 60000) * 60000
    db.prepare(`INSERT INTO perf_minutes (kind, name, minute, count, errors, sum_ms, max_ms, buckets) VALUES ('api', 'GET /old', ?, 1, 0, 5, 5, '[]')`).run(old)
    db.close()

    await server.stop()
    server = await startServer(dir, { PERF_FLUSH_SEC: '1' })
    const body = await report('7d')
    assert.ok(route(body, 'GET /catalog').count >= catalogBefore, 'still counted after the restart')

    const check = openDb(dir)
    const leftovers = check.prepare(`SELECT COUNT(*) AS n FROM perf_minutes WHERE name = 'GET /old'`).get().n
    check.close()
    assert.equal(leftovers, 0, 'rows older than PERF_KEEP_DAYS are deleted at startup')
  })
})
