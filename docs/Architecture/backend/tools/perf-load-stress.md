# Backend benchmark scripts: `perf-budget.js`, `load-test.js`, `stress-test.js`

All three start the **real `server.js` on a temporary folder** through `tests/helpers.js`, so they never touch `data/app.db`, `jobs/` or a developer's `.env`. They print tables to the console and set the exit code, so they can run in CI.

---

## `perf-budget.js` (`npm run perf`, author Ethan)
Measures the API against the **performance budget** in `README.md` and prints p50, p95 and max for each route. Requests go **one at a time over a kept-alive connection**, after a warm-up, so the numbers show the server's own speed on this machine. **Exits with 1 if any route is over budget.**

- Budgets: `JSON_P95_MS = 200`. `LOGIN_P95_MS = 500`, because sign-in hashes the password with scrypt on purpose. `MODEL_P95_MS = 3000` for the largest sample model (`fox.ply`, about 72 MB). `WARM_UP = 10`.
- **`percentile(sorted, p)`**: nearest rank.
- **`measure(label, count, run, warmUp)`**: runs `run()` `warmUp` times without timing, then `count` times with timing. **It throws on any HTTP status of 400 or above**, so a failing route cannot look fast. Returns `{ p50, p95, max }`.
- **`main()`**: creates 30 job folders that look finished, starts the server with `JOB_SOURCES=live,sample` and the API and download rate limits **turned off** (one user makes about 1,000 requests a minute here by design), signs up, and gives the 30 jobs to that user directly in the database. It checks that `sample-fox` has a model, then measures `GET catalog`, `auth/me`, `jobs`, `jobs/:id`, `scenes` (200 calls each), `POST auth/login` (15 calls, because login is limited to 30 per 15 minutes per address) and the fox `result.ply` download (10 calls). Prints a `console.table` and lists any routes over budget.

---

## `load-test.js` (`npm run load`, author Ethan)
**Many users using the API at the same time.** Each simulated user runs a whole visit with `runUserSession` (sign up, jobs, scenes, feedback, sign out).
- Settings: `LOAD_USERS` (default 100 at once) and `LOAD_ROUNDS` (default 3; each round starts when the previous one has finished).
- The server starts with `TRUST_PROXY=true`, so each simulated user's `X-Forwarded-For` counts as its own address.
- It collects per-route timings, the request count, and 5xx or no-reply responses. Afterwards it checks that the server **still answers `/catalog` quickly**.
- Prints totals, requests per second, a per-route p50/p95/max table and the first errors. **Exits with 1** on any failed request, any 5xx, or a server that stopped answering.

---

## `stress-test.js` (`npm run stress:ramp | stress:heavy | stress:soak`, author Gabriel)
Like the load test, but with the **real rate limits** and `UV_THREADPOOL_SIZE=16` as on the VM. Every simulated user is a new account from its own address. "Light routes" means every route in a visit except sign-up and sign-in, which hash the password and are slow on purpose.

### Scenarios
- **`ramp`** (where does it break?): more and more users at once (`STRESS_STEPS`, default `50,100,200,400,800`) until requests fail or the light routes' p95 goes past `STRESS_P95_MS` (default 1000). Prints the most users served within the 200 ms budget, within the limit, and the breaking point. Exits with 1 only if the server stopped answering.
- **`heavy`** (do builds, downloads and sign-ins slow everyone else down?): `STRESS_LANES` (20) users browse to set a baseline. Then, all at once: `STRESS_DOWNLOADS` (20) full fox downloads, `STRESS_UPLOADS` (10) uploads of 50 photos each, 5 rejected uploads and 50 sign-ins. It checks every status and every download's size, that the **build queue empties**, and that **rejected uploads leave no folder**. Exits with 1 on any problem, or if the light routes' p95 during the heavy work goes past the limit.
- **`soak`** (does memory or speed drift?): `STRESS_LANES` (10) users browse with `STRESS_PAUSE_MS` (2000) between visits for `STRESS_MINUTES` (30), printing one row per minute with the **server's memory**. Exits with 1 on any failure, if memory grows past `STRESS_MAX_GROWTH` (1.5×) its size after warm-up, or if the light routes' p95 in the last minutes goes past the limit.

### Helpers
| Function | Purpose |
|---|---|
| `setting(name, fallback)` | A positive number from the environment, or the fallback. |
| `sleep(ms)`, `percentile(sorted, p)`, `stats(times)`, `statsRow(what, times)` | Timing helpers. `stats` returns `{ n, p50, p95, max }`. |
| `printHeader(scenario)` | Machine, Node and settings line. |
| `startStressServer(name)` | `startServer` with the VM-like settings. |
| `stillUp(server)` / `printAfter(after)` | Whether the server still answers afterwards, and how fast. |
| `browse(base, lanes, nextIndex, onCall, { until, pauseMs, onVisit })` | Keeps `lanes` users running visits until `until()` returns true. |
| `ownUser(base, index, prefix)` | An account the script makes itself, numbered from `OWN_USERS_FROM = 1 000 000` so its address and email never clash with the simulated visits. |
| `photoForm(count)` | A multipart form with `count` copies of the sample photo. |
| `download(base, urlPath, user)` | A full download, checking the byte count. |
| `timed(work)` | `{ ms, result }`. |
| `serverMemoryMB(pid)` | The server process's resident memory, read through the OS (`tasklist`/`ps`). |
| `ramp()`, `heavy()`, `soak()` | The three scenarios, picked from `SCENARIOS` by the command-line argument. |
