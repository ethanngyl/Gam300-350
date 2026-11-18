/*!************************************************************************
\file password-reset.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-11-2026
\brief
"Forgot password?" with an emailed 6-digit code. Emails go to an outbox
folder (MAIL_OUTBOX_DIR) instead of being sent, and the tests read the code
from there. Covers: the full reset (old password and sessions stop working,
the new password works, a "password changed" email), the same answer for
an unknown email, wrong codes (the code dies after 5), expiry, the resend
cooldown, weak passwords, codes stored only as hashes, a team machine
passing it all to the VM, and the per-IP limit and "not set up" answers.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { call, openDb, sessionCookie, signUp, startServer, tempDir } from './helpers.js'

const PASSWORD = 'correct-horse-battery'
// Under 16 characters, so secrets.test.js doesn't take it for a real one.
const NEW_PASSWORD = 'new-pass-1234'
const KEY = 'test-shared-key-0123456789'
// RESET_CODE_TTL_MIN for the tests: 6 seconds, so expiry can be tested.
const TTL_MIN = 0.1

// ----- Helpers ------------------------------------------------------- //

// Every email in an outbox folder, oldest first.
function outbox(dir)
{
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
}

// The next email to an address (sent in the background, so wait for it).
async function waitForEmail(dir, to, count = 1)
{
  for (let i = 0; i < 50; i++)
  {
    const mails = outbox(dir).filter((mail) => mail.to === to)
    if (mails.length >= count) return mails[count - 1]
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.fail(`no email ${count} to ${to}`)
}

const codeFrom = (mail) => mail.text.match(/\b(\d{6})\b/)[1]
const login = (base, email, password) => call(base, 'POST', '/api/v1/auth/login', { json: { email, password } })
const forgot = (base, email) => call(base, 'POST', '/api/v1/auth/forgot-password', { json: { email } })
const reset = (base, email, code, newPassword = NEW_PASSWORD) =>
  call(base, 'POST', '/api/v1/auth/reset-password', { json: { email, code, newPassword } })
// A different 6-digit code.
const wrongCode = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

// ----- Tests --------------------------------------------------------- //

describe('"Forgot password?" on the machine that holds the accounts', () =>
{
  // The per-IP limits (10 requests, 10 resets) cover every test below.
  let dir, mailDir, server
  before(async () =>
  {
    dir = tempDir('reset')
    mailDir = path.join(dir, 'outbox')
    server = await startServer(dir, { MAIL_OUTBOX_DIR: mailDir, RESET_CODE_TTL_MIN: String(TTL_MIN) })
  })
  after(() => server?.stop())

  test('the full reset: emailed code, new password works, old password and sessions don\'t', async () =>
  {
    const { cookie } = await signUp(server.base, { email: 'alice@example.com', name: 'Alice', password: PASSWORD })
    const asked = await forgot(server.base, 'alice@example.com')
    assert.equal(asked.status, 202)
    assert.match(asked.body.message, /If an account exists/)

    const mail = await waitForEmail(mailDir, 'alice@example.com')
    assert.match(mail.text, /\b\d{6}\b/)
    assert.match(mail.text, /didn't ask/)
    const done = await reset(server.base, 'alice@example.com', codeFrom(mail))
    assert.equal(done.status, 200)
    assert.equal(sessionCookie(done), null, 'a reset doesn\'t sign in by itself')

    assert.equal((await call(server.base, 'GET', '/api/v1/auth/me', { cookie })).status, 401, 'old session signed out')
    assert.equal((await login(server.base, 'alice@example.com', PASSWORD)).status, 401, 'old password refused')
    assert.equal((await login(server.base, 'alice@example.com', NEW_PASSWORD)).status, 200, 'new password works')

    const notice = await waitForEmail(mailDir, 'alice@example.com', 2)
    assert.match(notice.subject, /password was changed/i)
    // The code works once.
    assert.equal((await reset(server.base, 'alice@example.com', codeFrom(mail), 'yet-another-password')).status, 400)
  })

  test('an email without an account gets the same answer, and no email', async () =>
  {
    const before = outbox(mailDir).length
    const asked = await forgot(server.base, 'nobody@example.com')
    assert.equal(asked.status, 202)
    assert.match(asked.body.message, /If an account exists/)
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(outbox(mailDir).length, before)
    const tried = await reset(server.base, 'nobody@example.com', '123456')
    assert.equal(tried.status, 400)
    assert.match(tried.body.error, /wrong or has expired/)
  })

  test('5 wrong codes and the code stops working', async () =>
  {
    await signUp(server.base, { email: 'bob@example.com', name: 'Bob', password: PASSWORD })
    await forgot(server.base, 'bob@example.com')
    const code = codeFrom(await waitForEmail(mailDir, 'bob@example.com'))
    for (let i = 0; i < 5; i++)
    {
      const wrong = await reset(server.base, 'bob@example.com', wrongCode(code))
      assert.equal(wrong.status, 400)
    }
    assert.equal((await reset(server.base, 'bob@example.com', code)).status, 400, 'the right code no longer works')
    assert.equal((await login(server.base, 'bob@example.com', PASSWORD)).status, 200, 'password unchanged')
  })

  test('a code expires', async () =>
  {
    await signUp(server.base, { email: 'carol@example.com', name: 'Carol', password: PASSWORD })
    await forgot(server.base, 'carol@example.com')
    const code = codeFrom(await waitForEmail(mailDir, 'carol@example.com'))
    await new Promise((resolve) => setTimeout(resolve, TTL_MIN * 60_000 + 500))
    assert.equal((await reset(server.base, 'carol@example.com', code)).status, 400)
  })

  test('one request per email per minute', async () =>
  {
    await signUp(server.base, { email: 'dave@example.com', name: 'Dave', password: PASSWORD })
    assert.equal((await forgot(server.base, 'dave@example.com')).status, 202)
    const again = await forgot(server.base, 'DAVE@example.com')
    assert.equal(again.status, 429)
    assert.ok(Number(again.headers.get('retry-after')) > 0)
  })

  test('the new password follows the password rule, and the code isn\'t spent on it', async () =>
  {
    const code = codeFrom(await waitForEmail(mailDir, 'dave@example.com'))
    const weak = await reset(server.base, 'dave@example.com', code, '123')
    assert.equal(weak.status, 400)
    assert.match(weak.body.error, /at least 6/)
    assert.equal((await reset(server.base, 'dave@example.com', code)).status, 200)
  })

  test('a bad body is refused', async () =>
  {
    assert.equal((await forgot(server.base, 'not-an-email')).status, 400)
  })

  test('codes are stored only as hashes', async () =>
  {
    await signUp(server.base, { email: 'frank@example.com', name: 'Frank', password: PASSWORD })
    await forgot(server.base, 'frank@example.com')
    const code = codeFrom(await waitForEmail(mailDir, 'frank@example.com'))
    const db = openDb(dir)
    try
    {
      const rows = db.prepare('SELECT code_hash FROM password_resets').all()
      assert.ok(rows.length >= 1)
      for (const { code_hash: hash } of rows)
      {
        assert.match(hash, /^[0-9a-f]{32}:[0-9a-f]{128}$/)
        assert.ok(!hash.includes(code))
      }
    }
    finally
    {
      db.close()
    }
  })
})

describe('"Forgot password?" on a team machine goes through the VM', () =>
{
  let vm, team, mailDir
  before(async () =>
  {
    const vmDir = tempDir('reset-vm')
    mailDir = path.join(vmDir, 'outbox')
    vm = await startServer(vmDir, { AUTH_MODE: 'authority', AUTH_API_KEY: KEY, MAIL_OUTBOX_DIR: mailDir })
    team = await startServer(tempDir('reset-team'), { AUTH_MODE: 'client', AUTH_API_KEY: KEY, VM_AUTH_URL: vm.base, AUTH_ALLOW_HTTP: '1' })
  })
  after(async () =>
  {
    await team?.stop()
    await vm?.stop()
  })

  test('the VM emails the code, and the reset signs the team machine\'s sessions out', async () =>
  {
    const { cookie } = await signUp(team.base, { email: 'erin@example.com', name: 'Erin', password: PASSWORD })
    assert.equal((await call(team.base, 'GET', '/api/v1/auth/me', { cookie })).status, 200)

    assert.equal((await forgot(team.base, 'erin@example.com')).status, 202)
    const code = codeFrom(await waitForEmail(mailDir, 'erin@example.com'))
    const wrong = await reset(team.base, 'erin@example.com', wrongCode(code))
    assert.equal(wrong.status, 400)
    assert.match(wrong.body.error, /wrong or has expired/)

    const done = await reset(team.base, 'erin@example.com', code)
    assert.equal(done.status, 200)
    assert.deepEqual(Object.keys(done.body), ['message'], 'the team machine doesn\'t pass on the VM\'s account id')
    assert.equal((await call(team.base, 'GET', '/api/v1/auth/me', { cookie })).status, 401, 'team machine session signed out')
    assert.equal((await login(team.base, 'erin@example.com', NEW_PASSWORD)).status, 200)
  })

  test('the VM\'s limits reach the team machine', async () =>
  {
    const again = await forgot(team.base, 'erin@example.com')
    assert.equal(again.status, 429)
    assert.ok(Number(again.headers.get('retry-after')) > 0)
  })
})

describe('"Forgot password?" without email set up', () =>
{
  let server
  before(async () =>
  {
    server = await startServer(tempDir('reset-off'))
  })
  after(() => server?.stop())

  test('says it isn\'t set up', async () =>
  {
    const reply = await forgot(server.base, 'someone@example.com')
    assert.equal(reply.status, 503)
    assert.match(reply.body.error, /isn't set up/)
  })

  test('each IP address may ask 10 times an hour', async () =>
  {
    // One request was made above.
    for (let i = 0; i < 9; i++) assert.notEqual((await forgot(server.base, `user${i}@example.com`)).status, 429)
    const over = await forgot(server.base, 'one-more@example.com')
    assert.equal(over.status, 429)
  })
})
