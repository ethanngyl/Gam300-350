# `backend/server.js`

*Authors: Gabriel, Xiong Yang, Ethan.* The entry point of the **Express 5** backend: startup, wiring and shutdown. It serves the built React frontend (`web-app/dist`) and the HTTP API that the website and the engine use to turn photos or videos into a Gaussian Splat `.ply` with COLMAP and Brush.

## Startup sequence (top-level code)
1. Creates `config.jobsDir`.
2. **Database file store (VM only):** if `FILE_STORE=db` is set but this machine is not the authority, it warns and ignores the setting. When `config.filesInDb` is on, it points `scan.js` at the database for image names and models (`setImageNameSource`, `setModelSource`), turns off copying samples into the engine folder (`setSkipSampleCopy(true)`), and runs `migrateToDb()`, which moves any photos and models still on disk into SQLite.
3. **Rebuilds the in-memory job list** with `scanJobs(jobsDir)` and `restoreJob` for each record. Jobs live in memory, so without this every job finished before a restart would 404.
4. **Resumes waiting builds:** restored jobs with `status === 'queued'` and a `status.json` go back through `queueBuild`, oldest first, each followed by `afterJobEnds`.
5. **Removes leftovers:** `.incoming-*` staging folders (shared-library uploads cut off part-way), `.video-*` files, and every job's `media/` folder (Frame Extractor uploads interrupted by a stop).
6. **Client mode:** `retireLocalAccounts()` deletes local accounts, because their ids and emails would clash with the VM's. Their uploads become admin-only, and a database backup path is logged.
7. Builds the `app`:
   - `trust proxy` from `TRUST_PROXY` (`true`, a hop count, or a named value such as `loopback`), so `req.ip` and `req.secure` describe the browser rather than the Caddy proxy.
   - `timeRequests` comes first, so body parsing is included in the timing. Then `startPerformance()`.
   - `express.json({ limit: maxJsonBodyMB })`. Express's default 100 KB is too small for a large saved scene.
   - `express.static(web-app/dist)`, then `loadUser`.
8. Builds **one API router** and mounts it **twice**: at `/api/v1` and, with `markLegacy`, at the old unversioned paths (marked deprecated). On that router:
   - `/library`: `requireAuthorityKey`, then `actAsUser` (team machines reach the job routes with the shared key, acting as the user they name).
   - `limitRequests(createLimiter({ 60 s, RATE_LIMIT_API_PER_MIN }))`.
   - Routers in this order: catalog, docs, **sampleJobs before jobs** (sample ids answer first), jobs, libraryStore, auth, passwordReset, account, feedback, scenes, metrics.
9. `jsonNotFound` and `jsonErrorHandler` come last.
10. `app.listen(config.port)` logs the tool paths, the build-concurrency limits (warning when `MAX_RUNNING_JOBS=0`, because builds then share the GPU), the rate limits and the account mode:
    - **authority:** warns if `AUTH_API_KEY` is missing; logs the file store, the clean-up rules, whether Google sign-in and mail are ready; calls `startCleanup()`.
    - **client:** checks `clientAuthProblem()`, warns about `AUTH_ALLOW_HTTP`, and starts `startLibrarySync()` only if there is no problem.
    - **local:** logs whether password-reset mail is on.

    It also probes the GPU (`getHardwareInfo`) and caches the result.
11. `server.requestTimeout = 30 min`. Node's default of 5 minutes would cut off a large upload on a slow connection.

## `shutdown(reason, exitCode = 0)`
Runs **only once** (`shuttingDown` guard). It calls `flushTimings()` to save performance samples not yet written, marks every `running` job as `error` (*"Server shut down during processing."*) and saves it, calls `killChildren()` to stop COLMAP, Brush and Python, then `process.exit(exitCode)`.

Signal wiring: `SIGINT`, `SIGTERM`, `SIGBREAK` and `SIGHUP` call `shutdown`. `SIGHUP` is how Windows reports a closed console window, with a few seconds' grace. `uncaughtException` and `unhandledRejection` log the error and call `shutdown('crashed', 1)`. `process.on('exit')` calls `killChildren()` as a last resort; it is synchronous, so it works there. **Tool processes are never left running on the GPU.**
