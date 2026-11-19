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
- Afterwards the server still answers quickly and hasn't exited.
Every test has a time limit, so a freeze or deadlock fails instead of hanging.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, openDb, startServer, tempDir } from './helpers.js'
import { runUserSession, userIp } from './simulatedUser.js'

const USERS = 30
const PARALLEL_EDITS = 25

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

  test('the server still answers quickly afterwards', { timeout: 10_000 }, async () =>
  {
    const start = performance.now()
    const reply = await call(server.base, 'GET', '/api/v1/catalog')
    assert.equal(reply.status, 200)
    assert.ok(performance.now() - start < 1000, 'catalog answered within 1 s')
    assert.equal(server.exitCode, null)
  })
})
