/*!************************************************************************
\file jobQueue.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
The line reconstruction builds wait in, so a machine runs only a few at a
time (config.maxRunningJobs, 1 by default): COLMAP and Brush share one GPU,
and two builds at once are each slower and can run out of GPU memory.
First come, first served. No imports, so the tests can use it directly;
services/jobs.js creates the one the server uses.
- createJobQueue({ maxRunning, onChange })
Returns { enqueue(job, start), refresh(), snapshot() }.
**************************************************************************/

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Creates a job queue.
  \param maxRunning
    number
    How many jobs may run at once (at least 1)
  \param onChange
    function
    Optional. Called with the waiting jobs, first in line first, whenever
    the line changes (to show each job its place)
  \return
    { enqueue, refresh, snapshot }:
    - enqueue(job, start): start() runs the job and returns a promise. It
      is called now if there is room, else when the jobs ahead are done.
      Returns a promise that settles when the run has ended (never
      rejects), or at once if the job was cancelled (job.cancelled) while
      waiting.
    - refresh(): drops cancelled jobs from the line and reports the change.
    - snapshot(): { running: number, waiting: job ids }, for tests.
*/
/************************************************************************/
export function createJobQueue({ maxRunning, onChange = () => {} })
{
  const limit = Math.max(1, Math.floor(maxRunning) || 1)
  // Each waiting entry: { job, start, done } (done resolves enqueue's promise).
  const waiting = []
  let running = 0

  function report()
  {
    try
    {
      onChange(waiting.map((entry) => entry.job))
    }
    catch (err)
    {
      console.error('[backend] job queue: showing places in line failed:', err)
    }
  }

  // Runs one job and starts the next when it ends, whatever the outcome.
  function launch(entry)
  {
    running++
    Promise.resolve()
      .then(() => entry.start())
      .catch((err) => console.error(`[backend] job ${entry.job.id} failed to run:`, err))
      .finally(() =>
      {
        running--
        entry.done()
        pump()
      })
  }

  // Lets go of cancelled jobs, then starts jobs while there is room.
  function pump()
  {
    let changed = dropCancelled()
    while (running < limit && waiting.length > 0)
    {
      launch(waiting.shift())
      changed = true
    }
    if (changed) report()
  }

  function dropCancelled()
  {
    let dropped = false
    for (let i = waiting.length - 1; i >= 0; i--)
    {
      if (!waiting[i].job.cancelled) continue
      waiting.splice(i, 1)[0].done()
      dropped = true
    }
    return dropped
  }

  function enqueue(job, start)
  {
    return new Promise((resolve) =>
    {
      const entry = { job, start, done: resolve }
      if (running < limit && waiting.length === 0)
      {
        launch(entry)
        return
      }
      waiting.push(entry)
      report()
    })
  }

  function refresh()
  {
    if (dropCancelled()) report()
    pump()
  }

  function snapshot()
  {
    return { running, waiting: waiting.map((entry) => entry.job.id) }
  }

  return { enqueue, refresh, snapshot }
}
// ----- End of Functions ----------------------------------------------------- //
