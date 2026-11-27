/*!************************************************************************
\file stress-test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-11-2026
\brief
Stress tests (in packages: npm run stress:ramp, stress:heavy, stress:soak).
Like the load test (load-test.js) they start the real server.js on a
temporary folder (tests/helpers.js), with the real rate limits and
UV_THREADPOOL_SIZE=16 as on the VM, and every simulated user is a new
account from their own address (tests/simulatedUser.js).
"Light routes" below means every route of a visit except sign-up and
sign-in, which hash the password and are slow on purpose.
- ramp: where does it break? More and more users at once
(STRESS_STEPS, default 50,100,200,400,800) until requests fail or light
routes' p95 passes STRESS_P95_MS (default 1000). Prints the most users
within the 200 ms budget, under the limit, and the breaking point.
Exits with 1 only if the server stopped answering.
- heavy: do builds, model downloads and sign-ins slow everyone else
down? Users browse (STRESS_LANES, default 20) for a baseline, then
STRESS_DOWNLOADS (20) full fox model downloads, STRESS_UPLOADS (10)
50-photo uploads, 5 rejected uploads and 50 sign-ins start at once.
Checks every status, every download's size, that the build queue empties
and that rejected uploads leave no folder. Exits with 1 on any problem or
if light routes' p95 during the heavy work passes STRESS_P95_MS.
- soak: does memory or speed drift? STRESS_LANES (10) users browse with
STRESS_PAUSE_MS (2000) between visits for STRESS_MINUTES (30); one row
per minute with the server's memory. Exits with 1 on any failure, memory
growing past STRESS_MAX_GROWTH (1.5) times its size after warm-up, or
light routes' p95 in the last minutes passing STRESS_P95_MS.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SAMPLE_PHOTO, call, sessionCookie, startServer, tempDir } from './tests/helpers.js'
import { runUserSession, userIp } from './tests/simulatedUser.js'

const run = promisify(execFile)

// The JSON routes' p95 budget (README.md "Performance budget").
const BUDGET_MS = 200
// Past this p95, the site feels broken.
const LIMIT_MS = setting('STRESS_P95_MS', 1000)
const THREADS = process.env.UV_THREADPOOL_SIZE || '16'

// Routes that hash a password; timed apart from the light routes.
const SLOW_ROUTES = new Set(['POST /auth/signup'])
const PASSWORD = 'Stress-test-pw!'
// Accounts the script makes itself are numbered from here, so their
// addresses and emails never clash with the simulated visits'.
const OWN_USERS_FROM = 1_000_000
const JOB_FOLDER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PHOTO = new Blob([fs.readFileSync(SAMPLE_PHOTO)], { type: 'image/jpeg' })

// ----- Start of Functions --------------------------------------------------- //

// A positive number from the environment, or fallback.
function setting(name, fallback)
{
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

// Value at percentile p (0-100) of sorted numbers, nearest rank.
function percentile(sorted, p)
{
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

// { n, p50, p95, max } of times in ms, or null if there are none.
function stats(times)
{
  if (times.length === 0) return null
  const sorted = [...times].sort((a, b) => a - b)
  return { n: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] }
}

const ms = (value) => (value == null ? '-' : value.toFixed(0))

// One table row: what, how many, p50 / p95 / max in ms.
function statsRow(what, times)
{
  const s = stats(times)
  return { what, n: s?.n ?? 0, 'p50 ms': ms(s?.p50), 'p95 ms': ms(s?.p95), 'max ms': ms(s?.max) }
}

function printHeader(scenario)
{
  console.log(`Stress test (${scenario}), ${new Date().toISOString().slice(0, 10)}, ` +
    `${os.cpus()[0]?.model.trim() ?? 'unknown CPU'}, Node ${process.version}, UV_THREADPOOL_SIZE=${THREADS}`)
}

/************************************************************************/
/*!
  \brief
    Starts the real backend on a new temporary folder, set up like the VM:
    behind a proxy (each user's own address counts), real rate limits,
    16 worker threads.
  \param name
    string, part of the folder's name
  \return
    { server, dir }
*/
/************************************************************************/
async function startStressServer(name)
{
  const dir = tempDir(`stress-${name}`)
  const server = await startServer(dir, { TRUST_PROXY: 'true', JOB_SOURCES: 'live,sample', UV_THREADPOOL_SIZE: THREADS })
  if (server.exitCode !== null) throw new Error(`server did not start:\n${server.log()}`)
  return { server, dir }
}

// Whether the server still answers, and how fast.
async function stillUp(server)
{
  const start = performance.now()
  const reply = await call(server.base, 'GET', '/api/v1/catalog').catch(() => ({ status: 0 }))
  return { up: reply.status === 200 && server.exitCode === null, ms: performance.now() - start }
}

function printAfter(after)
{
  console.log(`Server afterwards: ${after.up ? `up, answered in ${after.ms.toFixed(1)} ms` : 'NOT ANSWERING'}`)
}

/************************************************************************/
/*!
  \brief
    Simulated users browsing: lanes loops, each running one whole visit
    after another (every visit a new user), until until() is true.
  \param base
    string, the server's address
  \param lanes
    number of visits at a time
  \param nextIndex
    () => number, a new user number
  \param onCall
    (route, ms, status) => void, every request
  \param options
    { until: () => boolean, pauseMs: wait between a lane's visits,
    onVisit: ({ errors }) => void, after each visit }
  \return
    Promise, resolves once every lane has finished its last visit
*/
/************************************************************************/
function browse(base, lanes, nextIndex, onCall, { until, pauseMs = 0, onVisit = () => {} })
{
  const lane = async () =>
  {
    while (!until())
    {
      onVisit(await runUserSession(base, nextIndex(), onCall))
      if (pauseMs > 0 && !until()) await sleep(pauseMs)
    }
  }
  return Promise.all(Array.from({ length: lanes }, lane))
}

// A new account from its own address: { email, headers, cookie }.
async function ownUser(base, index, prefix)
{
  const headers = { 'X-Forwarded-For': userIp(index) }
  const email = `${prefix}-${index}@example.test`
  const reply = await call(base, 'POST', '/api/v1/auth/signup', { headers, json: { name: `${prefix} ${index}`, email, password: PASSWORD } })
  if (reply.status !== 201) throw new Error(`sign-up of ${email} failed: HTTP ${reply.status} ${JSON.stringify(reply.body)}`)
  return { email, headers, cookie: sessionCookie(reply) }
}

// An upload of count copies of the sample photo.
function photoForm(count)
{
  const form = new FormData()
  for (let i = 0; i < count; i++) form.append('images', PHOTO, `${String(i).padStart(4, '0')}.jpg`)
  return form
}

// Downloads urlPath as user, counting the bytes without keeping them.
async function download(base, urlPath, user)
{
  const reply = await fetch(base + urlPath, { headers: { cookie: user.cookie, ...user.headers } })
  const length = Number(reply.headers.get('content-length'))
  let bytes = 0
  if (reply.body)
  {
    for await (const chunk of reply.body) bytes += chunk.length
  }
  return { status: reply.status, length, bytes }
}

// Runs work(), timing it. A thrown error becomes { error }.
async function timed(work)
{
  const start = performance.now()
  try
  {
    const result = await work()
    return { ms: performance.now() - start, result }
  }
  catch (error)
  {
    return { ms: performance.now() - start, error }
  }
}

// The server process's memory (resident set) in MB, or null if unknown.
async function serverMemoryMB(pid)
{
  try
  {
    if (process.platform === 'win32')
    {
      const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`])
      return Number(stdout.trim()) / (1024 * 1024) || null
    }
    const { stdout } = await run('ps', ['-o', 'rss=', '-p', String(pid)])
    return Number(stdout.trim()) / 1024 || null
  }
  catch
  {
    return null
  }
}

const average = (values) => values.reduce((sum, v) => sum + v, 0) / values.length

/************************************************************************/
/*!
  \brief
    ramp: STRESS_STEPS users at once, one visit each, step after step,
    until requests fail or light routes' p95 passes STRESS_P95_MS.
*/
/************************************************************************/
async function ramp()
{
  const steps = (process.env.STRESS_STEPS || '50,100,200,400,800').split(',').map(Number).filter((n) => n > 0)
  const { server } = await startStressServer('ramp')
  try
  {
    const rows = []
    let index = 0
    let withinBudget = null
    let underLimit = null
    let breaking = null
    for (const users of steps)
    {
      const light = []
      const signUps = []
      let requests = 0
      let serverErrors = 0
      const onCall = (route, time, status) =>
      {
        requests++
        if (status >= 500 || status === 0) serverErrors++
        ;(SLOW_ROUTES.has(route) ? signUps : light).push(time)
      }
      const start = performance.now()
      const results = await Promise.all(Array.from({ length: users }, () => runUserSession(server.base, ++index, onCall)))
      const seconds = (performance.now() - start) / 1000
      const errors = results.flatMap((result) => result.errors)
      const lightStats = stats(light)
      rows.push({
        users, requests, 'req/s': (requests / seconds).toFixed(0),
        'light p95 ms': ms(lightStats?.p95), 'light max ms': ms(lightStats?.max), 'sign-up p95 ms': ms(stats(signUps)?.p95),
        failed: errors.length, '5xx / no reply': serverErrors,
      })

      const reasons = []
      if (errors.length > 0) reasons.push(`${errors.length} failed requests`)
      if (serverErrors > 0) reasons.push(`${serverErrors} 5xx / no reply`)
      if (!lightStats || lightStats.p95 > LIMIT_MS) reasons.push(`light routes p95 ${ms(lightStats?.p95)} ms, over ${LIMIT_MS} ms`)
      if (reasons.length > 0)
      {
        breaking = { users, reasons, errors }
        break
      }
      underLimit = users
      if (lightStats.p95 <= BUDGET_MS) withinBudget = users
      if (server.exitCode !== null) break
    }
    const after = await stillUp(server)

    printHeader('ramp')
    console.table(rows)
    console.log(`Within the ${BUDGET_MS} ms budget (light routes p95, no failures): up to ${withinBudget ?? 'none of the'} users at once`)
    console.log(`Under ${LIMIT_MS} ms (STRESS_P95_MS) with no failures: up to ${underLimit ?? 'none of the'} users at once`)
    if (breaking)
    {
      console.log(`Breaking point: ${breaking.users} users at once (${breaking.reasons.join(', ')})`)
      if (breaking.errors.length > 0) console.log(`First errors:\n  ${breaking.errors.slice(0, 5).join('\n  ')}`)
    }
    else
    {
      console.log(`Breaking point: not reached up to ${steps.at(-1)} users at once (try larger STRESS_STEPS)`)
    }
    printAfter(after)
    // Breaking is the result being measured; only a dead server fails the run.
    if (!after.up) process.exitCode = 1
  }
  finally
  {
    await server.stop()
  }
}

/************************************************************************/
/*!
  \brief
    heavy: a browsing baseline, then downloads, uploads (builds) and
    sign-ins all at once while users keep browsing; then the build queue
    must empty and rejected uploads must leave nothing behind.
*/
/************************************************************************/
async function heavy()
{
  const lanes = setting('STRESS_LANES', 20)
  const downloadCount = setting('STRESS_DOWNLOADS', 20)
  const uploadCount = setting('STRESS_UPLOADS', 10)
  const baselineMs = setting('STRESS_BASELINE_SEC', 10) * 1000
  const PHOTOS = 50
  const REJECTED = 5
  const SIGN_INS = 50
  const QUEUE_TIMEOUT_MS = 2 * 60 * 1000

  const { server, dir } = await startStressServer('heavy')
  const problems = []
  try
  {
    const base = server.base

    // The heavy work's accounts, made before anything is measured.
    let own = OWN_USERS_FROM
    const makeUsers = (count, prefix) => Promise.all(Array.from({ length: count }, () => ownUser(base, ++own, prefix)))
    const downloaders = await makeUsers(downloadCount, 'downloader')
    const uploaders = await makeUsers(uploadCount, 'uploader')
    const rejectedUploaders = await makeUsers(REJECTED, 'rejected')
    const signers = await makeUsers(SIGN_INS, 'signer')

    const jobs = await call(base, 'GET', '/api/v1/jobs', { cookie: downloaders[0].cookie, headers: downloaders[0].headers })
    if (!jobs.body.some((job) => job.id === 'sample-fox' && job.hasResult))
    {
      throw new Error('sample-fox has no model: is engine/assets/samples/fox.ply in the repo?')
    }

    // Users browse throughout; their light routes are timed per phase.
    let phase = 'baseline'
    let stop = false
    const light = { baseline: [], heavy: [] }
    const browseErrors = []
    let requests = 0
    let serverErrors = 0
    let visit = 0
    const onCall = (route, time, status) =>
    {
      requests++
      if (status >= 500 || status === 0) serverErrors++
      if (!SLOW_ROUTES.has(route) && light[phase]) light[phase].push(time)
    }
    const browsing = browse(base, lanes, () => ++visit, onCall, {
      until: () => stop,
      onVisit: ({ errors }) => browseErrors.push(...errors),
    })
    await sleep(baselineMs)

    phase = 'heavy'
    const heavyStart = performance.now()
    const as = (user) => ({ cookie: user.cookie, headers: user.headers })
    const [downloads, uploads, rejected, signIns] = await Promise.all([
      Promise.all(downloaders.map((user) => timed(() => download(base, '/api/v1/jobs/sample-fox/result.ply', user)))),
      Promise.all(uploaders.map((user) => timed(() => call(base, 'POST', '/api/v1/upload', { ...as(user), body: photoForm(PHOTOS) })))),
      Promise.all(rejectedUploaders.map((user) => timed(() => call(base, 'POST', '/api/v1/upload', { ...as(user), body: photoForm(3) })))),
      Promise.all(signers.map((user) => timed(() =>
        call(base, 'POST', '/api/v1/auth/login', { headers: user.headers, json: { email: user.email, password: PASSWORD } })))),
    ])
    const heavySec = (performance.now() - heavyStart) / 1000
    phase = 'after'
    stop = true
    await browsing

    // Every heavy request answered as expected?
    const check = (label, results, ok) =>
    {
      results.forEach(({ result, error }, i) =>
      {
        if (error) problems.push(`${label} ${i + 1}: ${error.message}`)
        else if (!ok(result)) problems.push(`${label} ${i + 1}: HTTP ${result.status} ${result.bytes !== undefined ? `(${result.bytes} of ${result.length} bytes)` : JSON.stringify(result.body).slice(0, 120)}`)
      })
    }
    check('download', downloads, (r) => r.status === 200 && r.length > 0 && r.bytes === r.length)
    check('upload', uploads, (r) => r.status === 202)
    check('rejected upload', rejected, (r) => r.status === 400)
    check('sign-in', signIns, (r) => r.status === 200)

    // The build queue empties: every accepted build ends (no COLMAP here,
    // so each one fails at its first step, one after another).
    const queueStart = performance.now()
    const pending = new Map()
    uploads.forEach(({ result }, i) =>
    {
      if (result?.status === 202) pending.set(result.body.id, uploaders[i])
    })
    const accepted = pending.size
    const endings = {}
    while (pending.size > 0 && performance.now() - queueStart < QUEUE_TIMEOUT_MS)
    {
      for (const [id, user] of pending)
      {
        const reply = await call(base, 'GET', `/api/v1/jobs/${id}`, as(user))
        if (reply.status === 200 && !['queued', 'running'].includes(reply.body.status))
        {
          endings[reply.body.status] = (endings[reply.body.status] ?? 0) + 1
          pending.delete(id)
        }
      }
      if (pending.size > 0) await sleep(500)
    }
    const queueSec = (performance.now() - queueStart) / 1000
    if (pending.size > 0) problems.push(`${pending.size} of ${accepted} builds still queued or running after ${QUEUE_TIMEOUT_MS / 60000} minutes`)

    // A rejected upload removes its folder: one folder per accepted upload.
    const folders = fs.readdirSync(path.join(dir, 'jobs'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && JOB_FOLDER_RE.test(entry.name)).length
    if (folders !== accepted) problems.push(`${folders} job folders, expected ${accepted} (one per accepted upload)`)

    const baseline = stats(light.baseline)
    const during = stats(light.heavy)
    if (browseErrors.length > 0) problems.push(`${browseErrors.length} failed browsing requests, first: ${browseErrors[0]}`)
    if (serverErrors > 0) problems.push(`${serverErrors} browsing requests got a 5xx or no reply`)
    if (!during || during.p95 > LIMIT_MS) problems.push(`browsing p95 during the heavy work ${ms(during?.p95)} ms, over ${LIMIT_MS} ms`)

    const after = await stillUp(server)
    if (!after.up) problems.push('the server stopped answering')

    const okTimes = (results) => results.filter((r) => !r.error).map((r) => r.ms)
    const foxMB = (downloads.find((r) => r.result?.length)?.result.length ?? 0) / (1024 * 1024)
    const speeds = stats(downloads.filter((r) => r.result?.bytes).map((r) => r.result.bytes / (1024 * 1024) / (r.ms / 1000)))

    printHeader('heavy')
    console.log(`Browsing: ${lanes} users at a time throughout, ${requests} requests, ${browseErrors.length} failed, ${serverErrors} 5xx / no reply`)
    console.table([
      statsRow(`browsing, light routes: baseline (${baselineMs / 1000} s)`, light.baseline),
      statsRow(`browsing, light routes: during the heavy work (${heavySec.toFixed(1)} s)`, light.heavy),
      statsRow(`${downloadCount} x full fox download (${foxMB.toFixed(0)} MB)`, okTimes(downloads)),
      statsRow(`${uploadCount} x upload of ${PHOTOS} photos`, okTimes(uploads)),
      statsRow(`${REJECTED} x upload of 3 photos (rejected)`, okTimes(rejected)),
      statsRow(`${SIGN_INS} x sign-in`, okTimes(signIns)),
    ])
    if (baseline && during) console.log(`Browsing p95 during the heavy work: ${(during.p95 / baseline.p95).toFixed(1)}x the baseline (${ms(baseline.p95)} -> ${ms(during.p95)} ms)`)
    if (speeds) console.log(`Speed of each download (all at once): median ${speeds.p50.toFixed(0)} MB/s, fastest ${speeds.max.toFixed(0)} MB/s`)
    console.log(`Build queue: ${accepted} accepted, ${accepted - pending.size} ended within ${queueSec.toFixed(1)} s ` +
      `(${Object.entries(endings).map(([status, n]) => `${status} x ${n}`).join(', ') || 'none'}; no COLMAP here, so each fails at its first step)`)
    console.log(`Job folders afterwards: ${folders} (expected ${accepted}, one per accepted upload)`)
    printAfter(after)
    if (problems.length > 0)
    {
      console.log(`Problems (${problems.length}):\n  ${problems.slice(0, 10).join('\n  ')}`)
      process.exitCode = 1
    }
    else
    {
      console.log('No problems.')
    }
  }
  finally
  {
    await server.stop()
  }
}

/************************************************************************/
/*!
  \brief
    soak: a steady, moderate load for STRESS_MINUTES; one row per minute
    with the server's memory, requests, light routes' p95 and failures.
*/
/************************************************************************/
async function soak()
{
  const minutes = setting('STRESS_MINUTES', 30)
  const lanes = setting('STRESS_LANES', 10)
  const pauseMs = process.env.STRESS_PAUSE_MS === '0' ? 0 : setting('STRESS_PAUSE_MS', 2000)
  const maxGrowth = setting('STRESS_MAX_GROWTH', 1.5)

  const { server } = await startStressServer('soak')
  try
  {
    const newBucket = () => ({ light: [], requests: 0, failures: 0, serverErrors: 0 })
    let bucket = newBucket()
    const buckets = []
    const rows = []
    const firstErrors = []
    let stop = false
    let visit = 0
    const onCall = (route, time, status) =>
    {
      bucket.requests++
      if (status >= 500 || status === 0) bucket.serverErrors++
      if (!SLOW_ROUTES.has(route)) bucket.light.push(time)
    }
    const started = Date.now()
    const browsing = browse(server.base, lanes, () => ++visit, onCall, {
      until: () => stop,
      pauseMs,
      onVisit: ({ errors }) =>
      {
        bucket.failures += errors.length
        if (firstErrors.length < 5) firstErrors.push(...errors.slice(0, 5 - firstErrors.length))
      },
    })

    printHeader('soak')
    console.log(`${lanes} users at a time, ${pauseMs} ms between visits, for ${minutes} minutes`)
    for (let minute = 1; minute <= minutes; minute++)
    {
      await sleep(started + minute * 60_000 - Date.now())
      const done = bucket
      bucket = newBucket()
      const memoryMB = await serverMemoryMB(server.pid)
      buckets.push({ ...done, memoryMB })
      const row = {
        minute, 'memory MB': memoryMB == null ? 'n/a' : memoryMB.toFixed(0), requests: done.requests,
        'light p95 ms': ms(stats(done.light)?.p95), failed: done.failures, '5xx / no reply': done.serverErrors,
      }
      rows.push(row)
      console.log(`  minute ${minute}/${minutes}: memory ${row['memory MB']} MB, ${row.requests} requests, light p95 ${row['light p95 ms']} ms, ${row.failed} failed`)
      if (server.exitCode !== null) break
    }
    stop = true
    await browsing
    const after = await stillUp(server)

    console.table(rows)
    const problems = []
    const failures = buckets.reduce((sum, b) => sum + b.failures, 0)
    const serverErrors = buckets.reduce((sum, b) => sum + b.serverErrors, 0)
    if (failures > 0) problems.push(`${failures} failed requests, first: ${firstErrors.join(' | ')}`)
    if (serverErrors > 0) problems.push(`${serverErrors} requests got a 5xx or no reply`)
    if (!after.up) problems.push('the server stopped answering')

    // Memory: the last 3 minutes against minutes 3-5 (after warm-up).
    const memory = buckets.map((b) => b.memoryMB)
    if (memory.length < 6)
    {
      console.log('Memory: too short to judge (needs at least 6 minutes)')
    }
    else if (memory.some((value) => value == null))
    {
      console.log('Memory: could not be read on this machine, not checked')
    }
    else
    {
      const warm = average(memory.slice(2, 5))
      const end = average(memory.slice(-3))
      console.log(`Memory: ${warm.toFixed(0)} MB after warm-up (minutes 3-5) -> ${end.toFixed(0)} MB at the end (last 3 minutes), ${(end / warm).toFixed(2)}x (limit ${maxGrowth}x)`)
      if (end > warm * maxGrowth) problems.push(`memory grew ${(end / warm).toFixed(2)}x, over ${maxGrowth}x`)
    }

    // Speed: light routes over the last 3 minutes.
    const lastP95 = stats(buckets.slice(-3).flatMap((b) => b.light))?.p95
    console.log(`Light routes p95, last ${Math.min(3, buckets.length)} minutes: ${ms(lastP95)} ms (limit ${LIMIT_MS} ms)`)
    if (lastP95 == null || lastP95 > LIMIT_MS) problems.push(`light routes p95 in the last minutes ${ms(lastP95)} ms, over ${LIMIT_MS} ms`)

    printAfter(after)
    if (problems.length > 0)
    {
      console.log(`Problems (${problems.length}):\n  ${problems.join('\n  ')}`)
      process.exitCode = 1
    }
    else
    {
      console.log('No problems.')
    }
  }
  finally
  {
    await server.stop()
  }
}
// ----- End of Functions ----------------------------------------------------- //

const SCENARIOS = { ramp, heavy, soak }
const scenario = process.argv[2]
if (!SCENARIOS[scenario])
{
  console.error(`Usage: node stress-test.js <${Object.keys(SCENARIOS).join(' | ')}>`)
  process.exitCode = 1
}
else
{
  SCENARIOS[scenario]().catch((error) =>
  {
    console.error(error)
    process.exitCode = 1
  })
}
