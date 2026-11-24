/*!************************************************************************
\file queue.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
The build queue (jobQueue.js): each user runs one build at a time (or
MAX_RUNNING_JOBS_PER_USER) and different users at the same time, unless
the machine is capped (MAX_RUNNING_JOBS); first come first served among
the builds allowed to start; waiting jobs are told what they wait for; a
job cancelled while waiting leaves the line; a failing build doesn't stop
the line. After a restart, builds that were waiting are
resumed with their settings, a build that had started is "interrupted",
and a folder without a status.json is never started.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { createJobQueue } from '../jobQueue.js'
import { addJobFolder, startServer, tempDir } from './helpers.js'

const WAITING = 'dddddddd-1111-2222-3333-444444444444'
const STARTED = 'eeeeeeee-1111-2222-3333-444444444444'
const BARE = 'ffffffff-1111-2222-3333-444444444444'

// ----- Helpers ------------------------------------------------------- //

// A fake build the test finishes by hand: start() records that it started
// and returns a promise that settles on finish() (or fail()). owner is the
// user who started it (the queues below read it with ownerOf).
function fakeBuild(id, started, owner = 'alice')
{
  const job = { id, owner, cancelled: false }
  let finish, fail
  const ended = new Promise((resolve, reject) => { finish = resolve; fail = reject })
  return {
    job,
    start: () => { started.push(id); return ended },
    finish: () => finish(),
    fail: (err) => fail(err),
  }
}

// Lets queued promise callbacks run.
const settle = () => new Promise((resolve) => setImmediate(resolve))

const readStatus = (dir, id) => JSON.parse(fs.readFileSync(path.join(dir, 'jobs', id, 'status.json'), 'utf8'))

async function waitFor(check, what)
{
  for (let i = 0; i < 100; i++)
  {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.fail(`timed out waiting for ${what}`)
}

// ----- Tests --------------------------------------------------------- //

// The queue the server makes by default: one build at a time per user, no
// limit for the machine. options can change that.
const queueOf = (options = {}) => createJobQueue({ maxPerOwner: 1, ownerOf: (job) => job.owner, ...options })

// What onChange reported, as "id:waitingFor:ahead" strings.
const placesOf = (waiting) => waiting.map(({ job, waitingFor, ahead }) => `${job.id}:${waitingFor}:${ahead}`)

describe('the build queue', () =>
{
  test('each user runs one build at a time; different users at the same time', async () =>
  {
    const started = []
    const places = []
    const queue = queueOf({ onChange: (waiting) => places.push(placesOf(waiting)) })
    const a1 = fakeBuild('a1', started, 'alice')
    const a2 = fakeBuild('a2', started, 'alice')
    const a3 = fakeBuild('a3', started, 'alice')
    const b1 = fakeBuild('b1', started, 'bob')
    const ended = [a1, a2, a3, b1].map((build) => queue.enqueue(build.job, build.start))
    await settle()
    assert.deepEqual(started, ['a1', 'b1'])
    assert.deepEqual(queue.snapshot(), { running: 2, waiting: ['a2', 'a3'] })
    assert.deepEqual(places.at(-1), ['a2:own:1', 'a3:own:2'], 'each told how many of their own builds are ahead')

    b1.finish()
    await settle()
    await settle()
    assert.deepEqual(started, ['a1', 'b1'], 'bob finishing doesn\'t start alice\'s next build')

    a1.finish()
    await settle()
    await settle()
    assert.deepEqual(started, ['a1', 'b1', 'a2'])
    assert.deepEqual(places.at(-1), ['a3:own:1'])

    a2.finish()
    await settle()
    await settle()
    assert.deepEqual(started, ['a1', 'b1', 'a2', 'a3'])
    a3.finish()
    await Promise.all(ended)
    assert.deepEqual(queue.snapshot(), { running: 0, waiting: [] })
  })

  test('a user isn\'t held up by another user\'s waiting builds', async () =>
  {
    const started = []
    const queue = queueOf()
    const builds = [['a1', 'alice'], ['a2', 'alice'], ['b1', 'bob'], ['c1', 'carol']].map(([id, owner]) => fakeBuild(id, started, owner))
    builds.forEach((build) => queue.enqueue(build.job, build.start))
    await settle()
    assert.deepEqual(started, ['a1', 'b1', 'c1'])
    assert.deepEqual(queue.snapshot().waiting, ['a2'])
  })

  test('a machine limit of 1: one at a time for everyone, first come first served, each told its place', async () =>
  {
    const started = []
    const places = []
    const queue = queueOf({ maxRunning: 1, onChange: (waiting) => places.push(placesOf(waiting)) })
    const a = fakeBuild('a', started, 'alice')
    const b = fakeBuild('b', started, 'bob')
    const c = fakeBuild('c', started, 'carol')
    const ended = [a, b, c].map((build) => queue.enqueue(build.job, build.start))
    await settle()
    assert.deepEqual(started, ['a'])
    assert.deepEqual(queue.snapshot(), { running: 1, waiting: ['b', 'c'] })
    assert.deepEqual(places.at(-1), ['b:machine:1', 'c:machine:2'])

    a.finish()
    await ended[0]
    await settle()
    assert.deepEqual(started, ['a', 'b'])
    assert.deepEqual(places.at(-1), ['c:machine:1'])

    b.finish()
    await settle()
    await settle()
    assert.deepEqual(started, ['a', 'b', 'c'])
    c.finish()
    await Promise.all(ended)
    assert.deepEqual(queue.snapshot(), { running: 0, waiting: [] })
  })

  test('a machine limit still lets a user\'s own limit decide who goes next', async () =>
  {
    const started = []
    const places = []
    const queue = queueOf({ maxRunning: 2, onChange: (waiting) => places.push(placesOf(waiting)) })
    const builds = [['a1', 'alice'], ['a2', 'alice'], ['b1', 'bob'], ['c1', 'carol']].map(([id, owner]) => fakeBuild(id, started, owner))
    builds.forEach((build) => queue.enqueue(build.job, build.start))
    await settle()
    assert.deepEqual(started, ['a1', 'b1'], 'two at once on the machine; a2 waits for a1')
    assert.deepEqual(places.at(-1), ['a2:own:1', 'c1:machine:1'])

    builds[2].finish() // b1
    await settle()
    await settle()
    assert.deepEqual(started, ['a1', 'b1', 'c1'], 'carol goes next: alice still has a build running')
  })

  test('maxPerOwner 2 lets one user run two at once', async () =>
  {
    const started = []
    const queue = queueOf({ maxPerOwner: 2 })
    const builds = ['a', 'b', 'c'].map((id) => fakeBuild(id, started))
    builds.forEach((build) => queue.enqueue(build.job, build.start))
    await settle()
    assert.deepEqual(started, ['a', 'b'])
    builds[1].finish()
    await settle()
    await settle()
    assert.deepEqual(started, ['a', 'b', 'c'])
  })

  test('a job cancelled while waiting leaves the line and is never started', async () =>
  {
    const started = []
    const places = []
    const queue = queueOf({ onChange: (waiting) => places.push(waiting.map(({ job }) => job.id)) })
    const [a, b, c] = ['a', 'b', 'c'].map((id) => fakeBuild(id, started))
    queue.enqueue(a.job, a.start)
    const bEnded = queue.enqueue(b.job, b.start)
    queue.enqueue(c.job, c.start)

    b.job.cancelled = true
    queue.refresh()
    await bEnded
    assert.deepEqual(places.at(-1), ['c'], 'c moves up at once')

    a.finish()
    await settle()
    await settle()
    assert.deepEqual(started, ['a', 'c'])
  })

  test('a build that fails doesn\'t stop the line', async () =>
  {
    const started = []
    const queue = queueOf()
    const [a, b] = ['a', 'b'].map((id) => fakeBuild(id, started))
    const aEnded = queue.enqueue(a.job, a.start)
    queue.enqueue(b.job, b.start)
    a.fail(new Error('COLMAP crashed'))
    await aEnded // resolves, never rejects
    await settle()
    assert.deepEqual(started, ['a', 'b'])
  })
})

describe('after a restart', () =>
{
  test('waiting builds resume with their settings; started ones are interrupted; bare folders wait', async () =>
  {
    const dir = tempDir('queue-restart')
    const waitingFields = { status: 'queued', phase: 'upload', error: null, removeBackground: true, trainIters: 2000 }
    addJobFolder(dir, WAITING, waitingFields)
    addJobFolder(dir, STARTED, { status: 'queued', phase: 'upload', error: null })
    fs.writeFileSync(path.join(dir, 'jobs', STARTED, 'database.db'), '')
    addJobFolder(dir, BARE)
    fs.rmSync(path.join(dir, 'jobs', BARE, 'status.json'))

    // No masking tool or COLMAP here, so the resumed build fails straight away.
    const server = await startServer(dir, { MASK_SCRIPT: path.join(dir, 'no-such-script.py') })
    try
    {
      await waitFor(() => readStatus(dir, WAITING).status === 'error', 'the waiting build to run')
      const resumed = readStatus(dir, WAITING)
      assert.doesNotMatch(resumed.error, /Interrupted/)
      assert.equal(resumed.trainIters, 2000, 'kept its training setting')
      assert.equal(resumed.removeBackground, true, 'kept its background setting')
      assert.match(server.log(), /resumed 1 waiting build/)

      assert.match(readStatus(dir, STARTED).error, /Interrupted/)
      // A folder nobody submitted gets a record, but isn't built.
      assert.equal(readStatus(dir, BARE).status, 'queued')
    }
    finally
    {
      await server.stop()
    }
  })
})
