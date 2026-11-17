/*!************************************************************************
\file queue.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
The build queue (jobQueue.js): builds run one at a time (or
MAX_RUNNING_JOBS), first come first served; waiting jobs are told their
place; a job cancelled while waiting leaves the line; a failing build
doesn't stop the line. After a restart, builds that were waiting are
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
// and returns a promise that settles on finish() (or fail()).
function fakeBuild(id, started)
{
  const job = { id, cancelled: false }
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

describe('the build queue', () =>
{
  test('one at a time, first come first served, each told its place', async () =>
  {
    const started = []
    const places = []
    const queue = createJobQueue({ maxRunning: 1, onChange: (waiting) => places.push(waiting.map((job) => job.id)) })
    const [a, b, c] = ['a', 'b', 'c'].map((id) => fakeBuild(id, started))
    const ended = [a, b, c].map((build) => queue.enqueue(build.job, build.start))
    await settle()
    assert.deepEqual(started, ['a'])
    assert.deepEqual(queue.snapshot(), { running: 1, waiting: ['b', 'c'] })
    assert.deepEqual(places.at(-1), ['b', 'c'])

    a.finish()
    await ended[0]
    await settle()
    assert.deepEqual(started, ['a', 'b'])
    assert.deepEqual(places.at(-1), ['c'])

    b.finish()
    await settle()
    await settle()
    assert.deepEqual(started, ['a', 'b', 'c'])
    c.finish()
    await Promise.all(ended)
    assert.deepEqual(queue.snapshot(), { running: 0, waiting: [] })
  })

  test('maxRunning 2 runs two at once', async () =>
  {
    const started = []
    const queue = createJobQueue({ maxRunning: 2 })
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
    const queue = createJobQueue({ maxRunning: 1, onChange: (waiting) => places.push(waiting.map((job) => job.id)) })
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
    const queue = createJobQueue({ maxRunning: 1 })
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
