/*!************************************************************************
\file secrets.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
No secrets in the repository: no tracked file holds a key-shaped value, the
.env files (and a dot-less env) are ignored by git and none is tracked, and
the frontend never mentions the server-only secrets. Secrets belong in each
machine's packages/src/backend/.env (see .env.example).
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { REPO_ROOT } from './helpers.js'

const git = (...args) => spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const THIS_FILE = path.posix.join('packages', 'src', 'backend', 'tests', 'secrets.test.js')

// Shapes of real credentials. A setting line only counts when its value
// looks real (16+ characters, not a placeholder).
const SECRET_PATTERNS = [
  ['Google OAuth client secret', 'GOCSPX-[A-Za-z0-9_-]{20,}'],
  ['Google API key', 'AIza[0-9A-Za-z_-]{35}'],
  ['GitHub token', '(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}'],
  ['AWS access key', 'AKIA[0-9A-Z]{16}'],
  ['Slack token', 'xox[baprs]-[A-Za-z0-9-]{10,}'],
  ['private key', '-----BEGIN [A-Z ]*PRIVATE KEY-----'],
  ['secret setting', '(AUTH_API_KEY|CLIENT_SECRET|_SECRET|_PASSWORD|_TOKEN|API_KEY)[ ]*[=:][ ]*["\']?[A-Za-z0-9_+/=-]{16,}'],
]
const PLACEHOLDER_RE = /paste|your[-_]|example|placeholder|changeme|<[^>]+>/i

// ----- Tests --------------------------------------------------------- //

test('git is available and this is the repository', () =>
{
  const top = git('rev-parse', '--show-toplevel')
  assert.equal(top.status, 0, top.stderr)
})

test('no tracked file holds a key-shaped secret', () =>
{
  const found = []
  for (const [what, pattern] of SECRET_PATTERNS)
  {
    // -I: text files only. Vendored SDKs and lock files hold no settings.
    const run = git('grep', '-nIE', '-e', pattern, '--', '.', ':!*package-lock.json', ':!engine/Library', `:!${THIS_FILE}`)
    if (run.status > 1) assert.fail(run.stderr)
    for (const line of run.stdout.split('\n').filter(Boolean))
    {
      const [file] = line.split(':')
      if (file.endsWith('.example') || PLACEHOLDER_RE.test(line)) continue
      // Never print the value itself.
      found.push(`${what} in ${line.split(':').slice(0, 2).join(':')}`)
    }
  }
  assert.deepEqual(found, [], 'secrets must live in .env, not in tracked files')
})

test('.env files are ignored by git, and none is tracked', () =>
{
  const mustIgnore = ['.env', 'packages/src/backend/.env', 'packages/src/backend/env', 'packages/api-tests/.env', 'packages/.env.local']
  const run = git('check-ignore', '--no-index', ...mustIgnore)
  const ignored = new Set(run.stdout.split('\n').filter(Boolean))
  assert.deepEqual(mustIgnore.filter((file) => !ignored.has(file)), [], 'not ignored')

  const tracked = git('ls-files').stdout.split('\n').filter((file) => /(^|\/)(\.env(\.[\w-]+)?|env)$/.test(file) && !file.endsWith('.example'))
  assert.deepEqual(tracked, [], 'tracked env files')
})

test('the frontend never mentions the server-only secrets', () =>
{
  const run = git('grep', '-nIE', 'AUTH_API_KEY|X-Auth-Key|GOOGLE_CLIENT_SECRET|client_secret', '--', 'packages/src/web-app')
  assert.equal(run.stdout.trim(), '', 'the web app must not know the shared key or the Google secret')
})
