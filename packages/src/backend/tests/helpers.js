/*!************************************************************************
\file helpers.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Shared helpers for the backend tests (npm test, node:test; run in CI). Every
test uses its own temporary folder for the database and jobs, and runs the
real server.js in a child process with no .env (ENV_FILE points at nothing),
so the tests never touch data/app.db, jobs/ or a developer's settings.
- tempDir(name)
A new empty folder under the system's temp folder.
- isolatedEnv(dir, extra)
Environment variables for a backend that only uses dir.
- startServer(dir, env)
The real backend in a child process; resolves once it answers (or exits).
- call(base, method, path, options)
One HTTP request; the reply's status, headers and body (JSON when it is).
- signUp(base, user) / sessionCookie(reply)
A new account and its session cookie.
- openDb(dir)
The test backend's database, for checks and test-only changes.
- addJobFolder(dir, id, fields)
A job folder (status.json + one photo) as the pipeline leaves it.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

export const BACKEND_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_ROOT = path.join(BACKEND_DIR, '..', '..', '..')
export const SAMPLE_PHOTO = path.join(REPO_ROOT, 'Sample Image Set', '0001.jpg')

// Backend settings a developer's shell might have set; none may reach a test server.
const BACKEND_SETTING_RE = /^(AUTH_|VM_|GOOGLE_|FILE_STORE|JOB_SOURCES|CATALOG_FILE|SAMPLE_DATA_FILE|TRUST_PROXY|STORAGE_|CLEANUP_|FEEDBACK_|MACHINE_NAME|SYNC_|MIN_FREE|DATA_DIR|JOBS_DIR|ENGINE_SAMPLES|PORT$|COLMAP_|BRUSH_|TRAIN_ITERS|MAX_|FRAME_|MASK_|COVER_|NORMALIZE_|ENV_FILE)/

// ----- Start of Functions --------------------------------------------------- //

// Folders made by tempDir, removed when the test file's process ends.
const tempDirs = []
process.on('exit', () =>
{
  for (const dir of tempDirs)
  {
    try
    {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
    }
    catch
    {
      // A file still open (Windows): the system's temp clean-up gets it later.
    }
  }
})

export function tempDir(name)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `genesis-test-${name}-`))
  tempDirs.push(dir)
  return dir
}

export function isolatedEnv(dir, extra = {})
{
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !BACKEND_SETTING_RE.test(key)))
  return {
    ...env,
    ENV_FILE: path.join(dir, 'no-such.env'),
    AUTH_MODE: 'local',
    DATA_DIR: path.join(dir, 'data'),
    JOBS_DIR: path.join(dir, 'jobs'),
    ENGINE_SAMPLES_DIR: path.join(dir, 'engine-samples'),
    // No reconstruction tools: tests never train a model.
    COLMAP_BIN: path.join(dir, 'no-colmap'),
    BRUSH_BIN: path.join(dir, 'no-brush'),
    BRUSH_ITERS_FLAG: '--total-steps',
    COLMAP_LEGACY_FLAGS: '0',
    COLMAP_USE_GPU: '0',
    ...extra,
  }
}

function freePort()
{
  return new Promise((resolve, reject) =>
  {
    const probe = net.createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () =>
    {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

export async function startServer(dir, env = {})
{
  const port = await freePort()
  const child = spawn(process.execPath, [path.join(BACKEND_DIR, 'server.js')], {
    env: isolatedEnv(dir, { PORT: String(port), ...env }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  let exitCode = null
  const exited = new Promise((resolve) => child.on('close', (code) => { exitCode = code; resolve(code) }))
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 300 && exitCode === null; i++)
  {
    try
    {
      await fetch(`${base}/api/v1/catalog`)
      break
    }
    catch
    {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  return {
    base,
    exited,
    get exitCode() { return exitCode },
    log: () => log,
    stop: async () =>
    {
      if (exitCode === null) child.kill()
      await exited
    },
  }
}

export async function call(base, method, urlPath, { cookie, json, body, headers = {} } = {})
{
  const reply = await fetch(base + urlPath, {
    method,
    redirect: 'manual',
    headers: { ...(cookie ? { cookie } : {}), ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : body,
  })
  const type = reply.headers.get('content-type') ?? ''
  const raw = Buffer.from(await reply.arrayBuffer())
  let data = raw
  if (type.includes('json')) data = JSON.parse(raw.toString('utf8'))
  else if (type.startsWith('text/') || type.includes('yaml')) data = raw.toString('utf8')
  return { status: reply.status, headers: reply.headers, type, body: data }
}

export function sessionCookie(reply)
{
  const value = (reply.headers.get('set-cookie') ?? '').match(/genesis_session=([^;]+)/)?.[1]
  return value ? `genesis_session=${value}` : null
}

export async function signUp(base, { name = 'Test User', email, password = 'correct-horse-battery' })
{
  const reply = await call(base, 'POST', '/api/v1/auth/signup', { json: { name, email, password } })
  if (reply.status !== 201) throw new Error(`sign-up failed: ${reply.status} ${JSON.stringify(reply.body)}`)
  return { cookie: sessionCookie(reply), user: reply.body }
}

export function openDb(dir)
{
  return new DatabaseSync(path.join(dir, 'data', 'app.db'))
}

export function addJobFolder(dir, id, fields = {})
{
  const jobDir = path.join(dir, 'jobs', id)
  fs.mkdirSync(path.join(jobDir, 'images'), { recursive: true })
  fs.copyFileSync(SAMPLE_PHOTO, path.join(jobDir, 'images', '0000.jpg'))
  fs.writeFileSync(path.join(jobDir, 'status.json'), JSON.stringify({
    version: 1, id, status: 'error', phase: null, progress: 0, detail: null, error: 'COLMAP failed',
    source: 'upload', name: 'Test job', imageCount: 1, createdAt: Date.UTC(2026, 9, 10), updatedAt: Date.UTC(2026, 9, 11),
    result: null, logTail: [], ...fields,
  }))
}
// ----- End of Functions ----------------------------------------------------- //
