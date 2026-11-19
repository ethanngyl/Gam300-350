/*!************************************************************************
\file load-test.js
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-11-2026
\brief
Load test (npm run load in packages): many users use the API at the same
time, each running a whole visit (tests/simulatedUser.js: sign up, jobs,
scenes, feedback, sign out), against the real server.js on a temporary
folder like the tests. Prints the totals, requests per second and
p50 / p95 / max per route under that load, and checks the server is still
up and quick afterwards. Exits with 1 on any failed request, any 5xx or a
server that stopped answering.
Settings (environment variables):
- LOAD_USERS: users at the same time (default 100)
- LOAD_ROUNDS: how many times all of them run a visit (default 3); each
round starts when the previous one has finished
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import os from 'node:os'
import { call, startServer, tempDir } from './tests/helpers.js'
import { runUserSession } from './tests/simulatedUser.js'

const USERS = Number(process.env.LOAD_USERS) || 100
const ROUNDS = Number(process.env.LOAD_ROUNDS) || 3

// ----- Start of Functions --------------------------------------------------- //

// Value at percentile p (0-100) of sorted numbers, nearest rank.
function percentile(sorted, p)
{
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

/************************************************************************/
/*!
  \brief
    Starts the server, runs ROUNDS rounds of USERS simultaneous visits,
    prints the report and sets the exit code.
*/
/************************************************************************/
async function main()
{
  const server = await startServer(tempDir('load'), { TRUST_PROXY: 'true', JOB_SOURCES: 'live,sample' })
  if (server.exitCode !== null) throw new Error(`server did not start:\n${server.log()}`)

  const timings = new Map() // route -> ms[]
  let requests = 0
  let serverErrors = 0
  const errors = []

  try
  {
    const start = performance.now()
    for (let round = 0; round < ROUNDS; round++)
    {
      const results = await Promise.all(Array.from({ length: USERS }, (_, i) =>
        runUserSession(server.base, round * USERS + i + 1, (route, ms, status) =>
        {
          requests++
          if (status >= 500 || status === 0) serverErrors++
          if (!timings.has(route)) timings.set(route, [])
          timings.get(route).push(ms)
        })))
      errors.push(...results.flatMap((result) => result.errors))
    }
    const seconds = (performance.now() - start) / 1000

    // Still up and quick once the load is over?
    const afterStart = performance.now()
    const after = await call(server.base, 'GET', '/api/v1/catalog').catch(() => ({ status: 0 }))
    const afterMs = performance.now() - afterStart
    const alive = after.status === 200 && server.exitCode === null

    const rows = [...timings].map(([route, times]) =>
    {
      times.sort((a, b) => a - b)
      return { route, n: times.length, 'p50 ms': percentile(times, 50).toFixed(1), 'p95 ms': percentile(times, 95).toFixed(1), 'max ms': times[times.length - 1].toFixed(1) }
    })

    console.log(`Load test, ${new Date().toISOString().slice(0, 10)}, ${os.cpus()[0]?.model.trim() ?? 'unknown CPU'}, Node ${process.version}`)
    console.log(`${USERS} users at once x ${ROUNDS} rounds = ${USERS * ROUNDS} visits, ${requests} requests in ${seconds.toFixed(1)} s (${(requests / seconds).toFixed(0)} requests/s)`)
    console.table(rows)
    console.log(`Failed requests: ${errors.length}, 5xx / no reply: ${serverErrors}, server afterwards: ${alive ? `up, answered in ${afterMs.toFixed(1)} ms` : 'NOT ANSWERING'}`)
    if (errors.length > 0) console.log(`First errors:\n  ${errors.slice(0, 5).join('\n  ')}`)
    if (errors.length > 0 || serverErrors > 0 || !alive) process.exitCode = 1
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
