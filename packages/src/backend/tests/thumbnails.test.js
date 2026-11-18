/*!************************************************************************
\file thumbnails.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 16-11-2026
\brief
Small photo copies for the website's cards (GET .../images/:name?size=small).
A stand-in for tools/make_thumbs.py (a Node script, so the tests don't need
Pillow) checks the route: a WebP copy is sent and cached, cards asking at
once share one run, the original is sent when no copy can be made, bad
sizes are refused, other users' photos stay hidden, and on the VM with
FILE_STORE=db the copies are made from the database. The real script is
also tried when this machine's Python has Pillow.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { REPO_ROOT, SAMPLE_PHOTO, addJobFolder, call, openDb, signUp, startServer, tempDir } from './helpers.js'

const JOB = 'bbbbbbbb-1111-2222-3333-444444444444'
const DB_JOB = 'cccccccc-1111-2222-3333-444444444444'
const KEY = 'test-shared-key-0123456789'
const FAKE_WEBP = Buffer.from('RIFF\x0c\x00\x00\x00WEBPVP8 fake', 'latin1')

// ----- Helpers ------------------------------------------------------- //

// Stands in for make_thumbs.py: logs each run, waits a little (so requests
// overlap), then writes a fake <name>.webp for every photo.
function writeFakeScript(dir)
{
  const script = path.join(dir, 'fake-thumbs.mjs')
  fs.writeFileSync(script, `
import fs from 'node:fs'
import path from 'node:path'
const [imagesDir, outDir] = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_THUMB_RUNS, imagesDir + '\\n')
await new Promise((resolve) => setTimeout(resolve, 300))
fs.mkdirSync(outDir, { recursive: true })
for (const name of fs.readdirSync(imagesDir))
  fs.writeFileSync(path.join(outDir, name + '.webp'), Buffer.from(${JSON.stringify(FAKE_WEBP.toString('latin1'))}, 'latin1'))
`)
  return script
}

const runs = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [])
const photo = (base, cookie, query = '?size=small', id = JOB) =>
  call(base, 'GET', `/api/v1/jobs/${id}/images/0000.jpg${query}`, { cookie })

// A Python with Pillow, or null.
function pythonWithPillow()
{
  for (const bin of [process.env.PYTHON_BIN, 'python3', 'python'].filter(Boolean))
  {
    try
    {
      execFileSync(bin, ['-c', 'import PIL'], { stdio: 'ignore', windowsHide: true })
      return bin
    }
    catch { /* next */ }
  }
  return null
}

function addOwnedJob(dir, id, email)
{
  addJobFolder(dir, id)
  const db = openDb(dir)
  db.prepare('INSERT INTO jobs (id, owner_id) SELECT ?, id FROM users WHERE email = ?').run(id, email)
  db.close()
}

// ----- Tests --------------------------------------------------------- //

describe('small photo copies', () =>
{
  let dir, server, cookie, runsFile
  before(async () =>
  {
    dir = tempDir('thumbs')
    runsFile = path.join(dir, 'runs.txt')
    server = await startServer(dir, {
      PYTHON_BIN: process.execPath,
      THUMB_SCRIPT: writeFakeScript(dir),
      FAKE_THUMB_RUNS: runsFile,
    })
    ;({ cookie } = await signUp(server.base, { email: 'owner@example.com', name: 'Owner' }))
    addOwnedJob(dir, JOB, 'owner@example.com')
  })
  after(() => server?.stop())

  test('cards asking at once share one run, and get the WebP copy', async () =>
  {
    const replies = await Promise.all(Array.from({ length: 5 }, () => photo(server.base, cookie)))
    for (const reply of replies)
    {
      assert.equal(reply.status, 200)
      assert.match(reply.type, /image\/webp/)
      assert.match(reply.headers.get('cache-control'), /max-age=86400/)
      assert.deepEqual(reply.body, FAKE_WEBP)
    }
    assert.equal(runs(runsFile).length, 1)
    assert.ok(fs.existsSync(path.join(dir, 'jobs', `${JOB}_out`, 'thumbs', '0000.jpg.webp')))
  })

  test('later requests are served from disk', async () =>
  {
    assert.equal((await photo(server.base, cookie)).status, 200)
    assert.equal(runs(runsFile).length, 1)
  })

  test('without size, the original', async () =>
  {
    const reply = await photo(server.base, cookie, '')
    assert.equal(reply.status, 200)
    assert.match(reply.type, /image\/jpeg/)
    assert.deepEqual(reply.body, fs.readFileSync(SAMPLE_PHOTO))
  })

  test('another size is refused', async () =>
  {
    const reply = await photo(server.base, cookie, '?size=huge')
    assert.equal(reply.status, 400)
    assert.match(reply.body.error, /size/)
  })

  test('not signed in: 401; someone else\'s job: 404', async () =>
  {
    assert.equal((await photo(server.base, undefined)).status, 401)
    const other = await signUp(server.base, { email: 'other@example.com', name: 'Other' })
    assert.equal((await photo(server.base, other.cookie)).status, 404)
  })
})

describe('no copy can be made', () =>
{
  let server, cookie
  before(async () =>
  {
    const dir = tempDir('thumbs-off')
    server = await startServer(dir, { PYTHON_BIN: process.execPath, THUMB_SCRIPT: path.join(dir, 'no-such-script.mjs') })
    ;({ cookie } = await signUp(server.base, { email: 'owner@example.com', name: 'Owner' }))
    addOwnedJob(dir, JOB, 'owner@example.com')
  })
  after(() => server?.stop())

  test('the original is sent instead', async () =>
  {
    for (let i = 0; i < 2; i++)
    {
      const reply = await photo(server.base, cookie)
      assert.equal(reply.status, 200)
      assert.match(reply.type, /image\/jpeg/)
      assert.deepEqual(reply.body, fs.readFileSync(SAMPLE_PHOTO))
    }
  })
})

describe('on the VM with FILE_STORE=db', () =>
{
  let dir, server, cookie, runsFile
  before(async () =>
  {
    dir = tempDir('thumbs-db')
    runsFile = path.join(dir, 'runs.txt')
    server = await startServer(dir, {
      AUTH_MODE: 'authority',
      AUTH_API_KEY: KEY,
      FILE_STORE: 'db',
      PYTHON_BIN: process.execPath,
      THUMB_SCRIPT: writeFakeScript(dir),
      FAKE_THUMB_RUNS: runsFile,
    })
    ;({ cookie } = await signUp(server.base, { email: 'owner@example.com', name: 'Owner' }))
    addOwnedJob(dir, DB_JOB, 'owner@example.com')
    // The photo lives only in the database, as after moveImagesToDb.
    const imagesDir = path.join(dir, 'jobs', DB_JOB, 'images')
    const db = openDb(dir)
    const data = fs.readFileSync(path.join(imagesDir, '0000.jpg'))
    db.prepare('INSERT INTO job_images (job_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?)')
      .run(DB_JOB, '0000.jpg', 'image/jpeg', data.length, data)
    db.close()
    fs.rmSync(imagesDir, { recursive: true, force: true })
  })
  after(() => server?.stop())

  test('the copy is made from the database, and the temporary folder removed', async () =>
  {
    const reply = await photo(server.base, cookie, '?size=small', DB_JOB)
    assert.equal(reply.status, 200)
    assert.deepEqual(reply.body, FAKE_WEBP)
    assert.equal(runs(runsFile).length, 1)
    const outDir = path.join(dir, 'jobs', `${DB_JOB}_out`)
    assert.deepEqual(fs.readdirSync(outDir).filter((name) => name.startsWith('thumbs-src-')), [])
  })
})

describe('tools/make_thumbs.py with Pillow', () =>
{
  const python = pythonWithPillow()

  test('a real copy: small, WebP and upright', { skip: python ? false : 'no Python with Pillow here' }, () =>
  {
    const dir = tempDir('thumbs-real')
    const imagesDir = path.join(dir, 'images')
    const outDir = path.join(dir, 'thumbs')
    fs.mkdirSync(imagesDir)
    // A 2000x1500 photo whose EXIF says "turn 90 degrees": the copy is portrait.
    execFileSync(python, ['-c', `
from PIL import Image
image = Image.new("RGB", (2000, 1500), (200, 80, 40))
exif = Image.Exif()
exif[0x0112] = 6
image.save(r"${path.join(imagesDir, 'a.jpg')}", "JPEG", exif=exif)
`], { windowsHide: true })
    execFileSync(python, [path.join(REPO_ROOT, 'tools', 'make_thumbs.py'), imagesDir, outDir], { windowsHide: true })
    const size = execFileSync(python, ['-c', `
from PIL import Image
with Image.open(r"${path.join(outDir, 'a.jpg.webp')}") as image:
    print(image.format, image.width, image.height)
`], { windowsHide: true }).toString().trim()
    const [format, width, height] = size.split(' ')
    assert.equal(format, 'WEBP')
    assert.ok(Number(height) === 480 && Number(width) === 360, size)
  })
})
