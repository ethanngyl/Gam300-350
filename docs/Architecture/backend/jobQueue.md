# `backend/jobQueue.js`

*Author: Gabriel.* The queue that reconstruction builds wait in. Each user runs a limited number of builds at a time (`config.maxRunningJobsPerUser`, 1 by default) and waits for their own earlier builds, while **different users' builds run at the same time**. The whole machine can also be capped (`config.maxRunningJobs`, no cap by default), because COLMAP and Brush share one GPU: builds running together are each slower and can run out of GPU memory. Among the builds allowed to start, it is first come, first served. The module has **no imports**, so the tests can use it directly. [services/jobs.js](services/jobs.md) creates the one the server uses.

## `createJobQueue({ maxPerOwner, maxRunning = 0, ownerOf = () => null, onChange = () => {} })`
- `perOwner = max(1, floor(maxPerOwner))`, `machineLimit = max(0, floor(maxRunning))`, where 0 means no limit.
- `ownerOf(job)` is read **once**, when the job is queued. Jobs with the same owner share `perOwner`.
- `onChange(waiting)` is called whenever the queue changes, with `[{ job, waitingFor: 'own' | 'machine', ahead }]` in queue order, so each job can show its place. Errors thrown by it are caught and logged.

### Internal state
`waiting` (entries `{ job, owner, start, done }`), `runningByOwner: Map`, `running`.

### Internal functions
- **`ownerRunning(owner)`**, **`machineFull()`**.
- **`places()`**: for each waiting job, `ownAhead` is the owner's running builds plus the owner's builds earlier in the queue. If that is at least `perOwner`, the job waits for its **own** builds, with `ahead = ownAhead − perOwner + 1`. Otherwise it waits for the **machine**, with `ahead = max(1, running + machine-waiters before it − limit + 1)`.
- **`report()`**: calls `onChange(places())` inside a `try` block.
- **`launch(entry)`**: increments the counters and runs `start()` (errors are logged). When it settles, whatever the outcome, it decrements the counters, resolves `done`, and calls `pump()`.
- **`pump()`**: drops cancelled jobs, then walks the queue in order and launches every job whose owner has room, while the machine has room. The others keep their place. It reports if anything changed.
- **`dropCancelled()`**: removes waiting jobs with `job.cancelled`, resolving their promises. Returns whether any were dropped.

### Returned API
- **`enqueue(job, start)`**: returns a promise that settles when the run ends (it **never rejects**), or straight away if the job is cancelled while waiting. The job **starts at once** only if the machine has room, the owner has room, **and the owner has no earlier build already waiting** (so it cannot overtake its own earlier job). Otherwise it joins the queue and the queue reports.
- **`refresh()`**: drops cancelled jobs (reporting if any were dropped), then pumps.
- **`snapshot()`**: `{ running, waiting: [job ids] }`, for tests.
