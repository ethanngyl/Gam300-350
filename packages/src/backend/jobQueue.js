/*!************************************************************************
\file jobQueue.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
The line reconstruction builds wait in. Each user runs a few builds at a
time (config.maxRunningJobsPerUser, 1 by default) and waits for their own
earlier builds; different users' builds run at the same time. The whole
machine can also be capped (config.maxRunningJobs, no cap by default):
COLMAP and Brush share one GPU, and builds at once are each slower and can
run out of GPU memory. First come, first served among the builds allowed
to start. No imports, so the tests can use it directly; services/jobs.js
creates the one the server uses.
- createJobQueue({ maxPerOwner, maxRunning, ownerOf, onChange })
Returns { enqueue(job, start), refresh(), snapshot() }.
**************************************************************************/

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Creates a job queue.
  \param maxPerOwner
    number
    How many jobs one owner may have running at once (at least 1)
  \param maxRunning
    number
    Optional. How many jobs may run at once in all; 0 (the default) means
    no limit
  \param ownerOf
    function
    Optional. job => its owner (any value; jobs with the same owner share
    maxPerOwner). Read once, when the job is queued. By default every job
    has the same owner (null)
  \param onChange
    function
    Optional. Called whenever the line changes (to show each job its
    place), with the waiting jobs, first in line first, each as
    { job, waitingFor, ahead }: waitingFor is 'own' (its owner's earlier
    builds) or 'machine' (the machine is full), and ahead is how many of
    those have to finish before it can start
  \return
    { enqueue, refresh, snapshot }:
    - enqueue(job, start): start() runs the job and returns a promise. It
      is called now if there is room, else when the jobs it waits for are
      done. Returns a promise that settles when the run has ended (never
      rejects), or at once if the job was cancelled (job.cancelled) while
      waiting.
    - refresh(): drops cancelled jobs from the line and reports the change.
    - snapshot(): { running: number, waiting: job ids }, for tests.
*/
/************************************************************************/
export function createJobQueue({ maxPerOwner, maxRunning = 0, ownerOf = () => null, onChange = () => {} })
{
  const perOwner = Math.max(1, Math.floor(maxPerOwner) || 1)
  const machineLimit = Math.max(0, Math.floor(maxRunning) || 0) // 0 = no limit
  // Each waiting entry: { job, owner, start, done } (done resolves enqueue's promise).
  const waiting = []
  const runningByOwner = new Map() // owner -> jobs running
  let running = 0

  const ownerRunning = (owner) => runningByOwner.get(owner) ?? 0
  const machineFull = () => machineLimit > 0 && running >= machineLimit

  // What each waiting job waits for, in line order (see onChange).
  function places()
  {
    const ownWaitingBefore = new Map()
    let machineWaitingBefore = 0
    return waiting.map(({ job, owner }) =>
    {
      const ownAhead = ownerRunning(owner) + (ownWaitingBefore.get(owner) ?? 0)
      ownWaitingBefore.set(owner, (ownWaitingBefore.get(owner) ?? 0) + 1)
      if (ownAhead >= perOwner) return { job, waitingFor: 'own', ahead: ownAhead - perOwner + 1 }
      const ahead = Math.max(1, running + machineWaitingBefore - machineLimit + 1)
      machineWaitingBefore++
      return { job, waitingFor: 'machine', ahead }
    })
  }

  function report()
  {
    try
    {
      onChange(places())
    }
    catch (err)
    {
      console.error('[backend] job queue: showing places in line failed:', err)
    }
  }

  // Runs one job and starts the next ones when it ends, whatever the outcome.
  function launch(entry)
  {
    running++
    runningByOwner.set(entry.owner, ownerRunning(entry.owner) + 1)
    Promise.resolve()
      .then(() => entry.start())
      .catch((err) => console.error(`[backend] job ${entry.job.id} failed to run:`, err))
      .finally(() =>
      {
        running--
        const left = ownerRunning(entry.owner) - 1
        if (left > 0) runningByOwner.set(entry.owner, left)
        else runningByOwner.delete(entry.owner)
        entry.done()
        pump()
      })
  }

  // Lets go of cancelled jobs, then starts, in line order, every waiting job
  // whose owner has room while the machine has room. The others keep their
  // place.
  function pump()
  {
    let changed = dropCancelled()
    for (let i = 0; i < waiting.length && !machineFull(); )
    {
      if (ownerRunning(waiting[i].owner) < perOwner)
      {
        launch(waiting.splice(i, 1)[0])
        changed = true
      }
      else
      {
        i++
      }
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
      const entry = { job, owner: ownerOf(job), start, done: resolve }
      // Nobody it would overtake: its owner has no earlier build waiting.
      const ownEarlierWaiting = waiting.some((other) => other.owner === entry.owner)
      if (!machineFull() && ownerRunning(entry.owner) < perOwner && !ownEarlierWaiting)
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
