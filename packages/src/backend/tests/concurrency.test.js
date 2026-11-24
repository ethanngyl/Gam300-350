/*!************************************************************************
\file concurrency.test.js
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-11-2026
\brief
Many users at once (guideline A4): the server stays up, answers every
request correctly, keeps each user's data to themselves and doesn't
deadlock when the same record is written at the same time.
- 30 users run a whole visit (simulatedUser.js) at the same moment: no
error, no 5xx, each sees only their own scene, the database totals add up.
- 25 simultaneous edits of one scene all succeed and the scene ends up as
one of them; reads in between always return a whole scene.
- 8 photo uploads (builds) and 4 rejected ones at once while 10 users
browse: right answers, every build leaves the queue, and the rejected
uploads leave no folder behind.
- Afterwards the server still answers quickly and hasn't exited.
Every test has a time limit, so a freeze or deadlock fails instead of hanging.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { SAMPLE_PHOTO, call, openDb, sessionCookie, startServer, tempDir } from './helpers.js'
import { runUserSession, userIp } from './simulatedUser.js'

const USERS = 30
const PARALLEL_EDITS = 25
const BUILDS = 8
const REJECTED_UPLOADS = 4
const BROWSERS = 10
const JOB_FOLDER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PHOTO = new Blob([fs.readFileSync(SAMPLE_PHOTO)], { type: 'image/jpeg' })

// An upload of count copies of the sample photo.
function photoForm(count)
{
  const form = new FormData()
  for (let i = 0; i < count; i++) form.append('images', PHOTO, `${String(i).padStart(4, '0')}.jpg`)
  return form
}

// ----- Tests --------------------------------------------------------- //

describe('many users at once', () =>
{
  let dir, server
  const statuses = []
  before(async () =>
  {
    dir = tempDir('concurrency')
    // TRUST_PROXY: each simulated user comes from their own address (X-Forwarded-For).
    server = await startServer(dir, { TRUST_PROXY: 'true', JOB_SOURCES: 'live,sample' })
  })
  after(() => server.stop())

  test(`${USERS} users run a whole visit at the same time`, { timeout: 60_000 }, async () =>
  {
    const results = await Promise.all(
      Array.from({ length: USERS }, (_, i) => runUserSession(server.base, i + 1, (route, ms, status) => statuses.push(status))),
    )
    const errors = results.flatMap((result) => result.errors)
    assert.deepEqual(errors, [], `errors under load:\n${errors.join('\n')}`)
    assert.equal(statuses.filter((status) => status >= 500).length, 0, 'no 5xx replies')
    assert.equal(server.exitCode, null, 'server still running')

    // Every write landed exactly once: one account and one feedback per user,
    // and every scene was deleted again.
    const db = openDb(dir)
    try
    {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE 'load-user-%'").get().n, USERS)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, USERS)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scenes').get().n, 0)
    }
    finally
    {
      db.close()
    }
  })

  test(`${PARALLEL_EDITS} simultaneous edits of one scene don't deadlock`, { timeout: 30_000 }, async () =>
  {
    const headers = { 'X-Forwarded-For': userIp(USERS + 1) }
    const signup = await call(server.base, 'POST', '/api/v1/auth/signup', {
      headers, json: { name: 'Editor', email: 'editor@example.test', password: 'editor-password-123' },
    })
    assert.equal(signup.status, 201)
    const cookie = `genesis_session=${signup.headers.get('set-cookie').match(/genesis_session=([^;]+)/)[1]}`
    const created = await call(server.base, 'POST', '/api/v1/scenes', {
      cookie, headers, json: { name: 'Shared', background: '#000000', renderMode: 'points', objects: [] },
    })
    assert.equal(created.status, 201)
    const id = created.body.id

    const names = Array.from({ length: PARALLEL_EDITS }, (_, i) => `Edit ${i}`)
    const replies = await Promise.all([
      ...names.map((name) => call(server.base, 'PUT', `/api/v1/scenes/${id}`, { cookie, headers, json: { ...created.body, name } })),
      // Reads racing the writes must always see a whole, valid scene.
      ...Array.from({ length: 10 }, () => call(server.base, 'GET', `/api/v1/scenes/${id}`, { cookie, headers })),
    ])
    for (const reply of replies) assert.equal(reply.status, 200, JSON.stringify(reply.body))
    for (const reply of replies.slice(PARALLEL_EDITS))
    {
      assert.ok(reply.body.name === 'Shared' || names.includes(reply.body.name), `read a broken scene: ${reply.body.name}`)
    }

    const final = await call(server.base, 'GET', `/api/v1/scenes/${id}`, { cookie, headers })
    assert.ok(names.includes(final.body.name), `final name "${final.body.name}" is one of the edits`)
  })

  test(`${BUILDS} uploads at once while users browse: the queue empties, rejected uploads leave nothing`, { timeout: 60_000 }, async () =>
  {
    // Each uploader is a new account from their own address.
    const uploader = async (index) =>
    {
      const headers = { 'X-Forwarded-For': userIp(index) }
      const reply = await call(server.base, 'POST', '/api/v1/auth/signup', {
        headers, json: { name: `Uploader ${index}`, email: `uploader-${index}@example.test`, password: 'uploader-password-123' },
      })
      assert.equal(reply.status, 201)
      return { headers, cookie: sessionCookie(reply) }
    }
    const accepted = await Promise.all(Array.from({ length: BUILDS }, (_, i) => uploader(100 + i)))
    const rejected = await Promise.all(Array.from({ length: REJECTED_UPLOADS }, (_, i) => uploader(200 + i)))
    const upload = (user, photos) => call(server.base, 'POST', '/api/v1/upload', { ...user, body: photoForm(photos) })

    const browseStatuses = []
    const [uploads, refusals, visits] = await Promise.all([
      Promise.all(accepted.map((user) => upload(user, 8))),
      Promise.all(rejected.map((user) => upload(user, 3))),
      Promise.all(Array.from({ length: BROWSERS }, (_, i) =>
        runUserSession(server.base, 300 + i, (route, ms, status) => browseStatuses.push(status)))),
    ])
    for (const reply of uploads) assert.equal(reply.status, 202, JSON.stringify(reply.body))
    for (const reply of refusals) assert.equal(reply.status, 400, JSON.stringify(reply.body))
    assert.deepEqual(visits.flatMap((visit) => visit.errors), [], 'browsing still works')
    assert.equal(browseStatuses.filter((status) => status >= 500).length, 0, 'no 5xx replies')

    // No COLMAP here, so each build fails at its first step; every one must
    // still leave the queue (one at a time) rather than wait forever.
    const pending = new Map(uploads.map((reply, i) => [reply.body.id, accepted[i]]))
    while (pending.size > 0)
    {
      for (const [id, user] of pending)
      {
        const reply = await call(server.base, 'GET', `/api/v1/jobs/${id}`, user)
        assert.equal(reply.status, 200)
        if (!['queued', 'running'].includes(reply.body.status)) pending.delete(id)
      }
      if (pending.size > 0) await new Promise((resolve) => setTimeout(resolve, 200))
    }

    // One folder per accepted upload: the rejected ones removed theirs.
    const folders = fs.readdirSync(path.join(dir, 'jobs'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && JOB_FOLDER_RE.test(entry.name))
    assert.equal(folders.length, BUILDS)
    assert.equal(server.exitCode, null, 'server still running')
  })

  test('the server still answers quickly afterwards', { timeout: 10_000 }, async () =>
  {
    const start = performance.now()
    const reply = await call(server.base, 'GET', '/api/v1/catalog')
    assert.equal(reply.status, 200)
    assert.ok(performance.now() - start < 1000, 'catalog answered within 1 s')
    assert.equal(server.exitCode, null)
  })
})
