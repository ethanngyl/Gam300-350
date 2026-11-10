/*!************************************************************************
\file perf-budget.js
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 07-11-2026
\brief
Measures the API against the performance budget in README.md
("Performance budget") and prints p50 / p95 / max per route. Run with
"npm run perf" in packages. Like the tests, it starts the real server.js
on a temporary folder (tests/helpers.js), so it never touches data/app.db,
jobs/ or a developer's .env, and uses the repo's sample models
(JOB_SOURCES=live,sample) for the model download.
Requests go one at a time over a kept-alive connection, after a warm-up,
so the numbers are the server's own speed on this machine; load from many
users at once is a separate test. Exits with 1 if any route is over budget.
- BUDGETS
Each measured route, how many times it is called and its p95 budget.
- measure(label, count, run)
Times run() count times; p50 / p95 / max in ms.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import os from 'node:os'
import { addJobFolder, call, openDb, signUp, startServer, tempDir } from './tests/helpers.js'

// p95 budgets in ms (README.md "Performance budget").
const JSON_P95_MS = 200
// Sign-in hashes the password with scrypt on purpose, so it gets its own budget.
const LOGIN_P95_MS = 500
// The largest sample model (fox.ply, about 72 MB) on this machine.
const MODEL_P95_MS = 3000

const WARM_UP = 10
const PASSWORD = 'perf-budget-password'

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Value at percentile p (0-100) of sorted numbers, nearest rank.
  \param sorted
    number[], ascending
  \param p
    number
  \return
    number
*/
/************************************************************************/
function percentile(sorted, p)
{
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

/************************************************************************/
/*!
  \brief
    Calls run() WARM_UP times untimed, then count times timed. Throws if a
    call answers with an unexpected status, so a failing route can't look fast.
  \param label
    string, for the error message
  \param count
    number
  \param run
    async () => number (the HTTP status)
  \param warmUp
    untimed calls first (default WARM_UP)
  \return
    { p50, p95, max } in ms
*/
/************************************************************************/
async function measure(label, count, run, warmUp = WARM_UP)
{
  for (let i = 0; i < warmUp; i++) await run()
  const times = []
  for (let i = 0; i < count; i++)
  {
    const start = performance.now()
    const status = await run()
    times.push(performance.now() - start)
    if (status >= 400) throw new Error(`${label}: HTTP ${status}`)
  }
  times.sort((a, b) => a - b)
  return { p50: percentile(times, 50), p95: percentile(times, 95), max: times[times.length - 1] }
}

/************************************************************************/
/*!
  \brief
    Starts the test server, measures every route in the budget, prints the
    table and sets the exit code.
*/
/************************************************************************/
async function main()
{
  const dir = tempDir('perf')
  // 30 finished-looking jobs, so GET /jobs lists a realistic library.
  for (let i = 0; i < 30; i++)
  {
    addJobFolder(dir, `perf-job-${String(i).padStart(2, '0')}`, { status: 'done', error: null, name: `Perf job ${i}` })
  }
  const server = await startServer(dir, { JOB_SOURCES: 'live,sample' })
  if (server.exitCode !== null) throw new Error(`server did not start:\n${server.log()}`)

  try
  {
    const { base } = server
    const email = 'perf@example.test'
    const { cookie } = await signUp(base, { email, password: PASSWORD })
    // Give the job folders to this account, as an upload would.
    const db = openDb(dir)
    const addJob = db.prepare('INSERT INTO jobs (id, owner_id) SELECT ?, id FROM users WHERE email = ?')
    for (let i = 0; i < 30; i++) addJob.run(`perf-job-${String(i).padStart(2, '0')}`, email)
    db.close()
    const get = (path) => async () => (await call(base, 'GET', path, { cookie })).status

    const jobs = (await call(base, 'GET', '/api/v1/jobs', { cookie })).body
    if (!jobs.some((job) => job.id === 'sample-fox' && job.hasResult))
    {
      throw new Error('sample-fox has no model: is engine/assets/samples/fox.ply in the repo?')
    }

    // [label, count, run, budget, warm-up]. Sign-in is limited to 30 per 15
    // minutes per address (routes/auth.js), so it gets fewer calls.
    const BUDGETS = [
      ['GET /api/v1/catalog', 200, get('/api/v1/catalog'), JSON_P95_MS],
      ['GET /api/v1/auth/me', 200, get('/api/v1/auth/me'), JSON_P95_MS],
      [`GET /api/v1/jobs (${jobs.length} jobs)`, 200, get('/api/v1/jobs'), JSON_P95_MS],
      ['GET /api/v1/jobs/:id', 200, get('/api/v1/jobs/perf-job-00'), JSON_P95_MS],
      ['GET /api/v1/scenes', 200, get('/api/v1/scenes'), JSON_P95_MS],
      ['POST /api/v1/auth/login', 15, async () =>
        (await call(base, 'POST', '/api/v1/auth/login', { json: { email, password: PASSWORD } })).status, LOGIN_P95_MS, 2],
      ['GET result.ply (fox, ~72 MB)', 10, get('/api/v1/jobs/sample-fox/result.ply'), MODEL_P95_MS],
    ]

    const rows = []
    for (const [label, count, run, budget, warmUp] of BUDGETS)
    {
      const { p50, p95, max } = await measure(label, count, run, warmUp)
      rows.push({ route: label, n: count, 'p50 ms': p50.toFixed(1), 'p95 ms': p95.toFixed(1), 'max ms': max.toFixed(1), 'budget p95 ms': budget, ok: p95 <= budget ? 'yes' : 'OVER' })
    }

    console.log(`Performance budget, ${new Date().toISOString().slice(0, 10)}, ${os.cpus()[0]?.model.trim() ?? 'unknown CPU'}, Node ${process.version}`)
    console.table(rows)
    const over = rows.filter((row) => row.ok !== 'yes')
    if (over.length > 0)
    {
      console.log(`Over budget: ${over.map((row) => row.route).join(', ')}`)
      process.exitCode = 1
    }
  }
  finally
  {
    await server.stop()
  }
}
// ----- End of Functions ----------------------------------------------------- //

main().catch((error) =>
{
  console.error(error)
  process.exitCode = 1
})
