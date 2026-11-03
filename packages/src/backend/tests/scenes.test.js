/*!************************************************************************
\file scenes.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Saved scenes (versioned format, services/scenes.js): save -> load returns
exactly what was saved, also after a restart; a version 0 scene (the
browser-only format) is converted; invalid or newer scenes are refused;
users only see their own; a team machine saves through the VM.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { call, sessionCookie, signUp, startServer, tempDir } from './helpers.js'

const KEY = 'test-shared-key-0123456789'
const PASSWORD = 'correct-horse-battery'
// What SceneStorage.js keeps in the browser today: version 0.
const V0_SCENE = {
  id: 'scene-mh2x1k-abc123',
  name: '  Living room  ',
  createdAt: 1790000000000,
  updatedAt: 1790000500000,
  background: '#202020',
  renderMode: 'points',
  hasUnsavedChanges: true,
  objects: [
    { objectId: 'obj-1', jobId: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'Fox', position: [1, 0, -2.5], rotation: [0, 90, 0], scale: [1.5, 1.5, 1.5],
      trim: { strength: 0.3, minOpacity: 0.1, maxSplatSize: 0, density: 0 }, isHidden: false },
    { objectId: 'obj-2', jobId: 'sample-fox', name: 'Old object', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  ],
}

// ----- Tests --------------------------------------------------------- //

describe('scenes on the VM', () =>
{
  let dir, vm, alice, bob, saved
  const startVm = () => startServer(dir, { AUTH_MODE: 'authority', AUTH_API_KEY: KEY })
  before(async () =>
  {
    dir = tempDir('scenes')
    vm = await startVm()
    alice = (await signUp(vm.base, { email: 'alice@example.com', password: PASSWORD })).cookie
    bob = (await signUp(vm.base, { email: 'bob@example.com', password: PASSWORD })).cookie
  })
  after(() => vm.stop())

  test('a version 0 scene is converted and saved as version 1', async () =>
  {
    const reply = await call(vm.base, 'POST', '/api/v1/scenes', { cookie: alice, json: V0_SCENE })
    assert.equal(reply.status, 201)
    saved = reply.body
    assert.equal(saved.format, 'genesis.scene')
    assert.equal(saved.version, 1)
    assert.match(saved.id, /^[0-9a-f-]{36}$/)
    assert.equal(saved.name, 'Living room')
    assert.ok(!('hasUnsavedChanges' in saved))
    assert.deepEqual(saved.objects[0], V0_SCENE.objects[0])
    assert.deepEqual(saved.objects[1].trim, { strength: 0, minOpacity: 0, maxSplatSize: 0, density: 0 })
    assert.equal(saved.objects[1].isHidden, false)
  })

  test('loading returns exactly what was saved', async () =>
  {
    const reply = await call(vm.base, 'GET', `/api/v1/scenes/${saved.id}`, { cookie: alice })
    assert.deepEqual(reply.body, saved)
  })

  test('saving again keeps createdAt, moves updatedAt, and loads back exactly', async () =>
  {
    await new Promise((resolve) => setTimeout(resolve, 5))
    const edited = { ...saved, name: 'Living room v2', objects: [{ ...saved.objects[0], position: [3, 0.5, 1e-6] }] }
    const put = await call(vm.base, 'PUT', `/api/v1/scenes/${saved.id}`, { cookie: alice, json: edited })
    assert.equal(put.status, 200)
    assert.equal(put.body.createdAt, saved.createdAt)
    assert.ok(put.body.updatedAt > saved.updatedAt)
    saved = put.body
    assert.deepEqual((await call(vm.base, 'GET', `/api/v1/scenes/${saved.id}`, { cookie: alice })).body, saved)
  })

  test('...and after a restart', async () =>
  {
    await vm.stop()
    vm = await startVm()
    assert.deepEqual((await call(vm.base, 'GET', `/api/v1/scenes/${saved.id}`, { cookie: alice })).body, saved)
  })

  test('a browser scene can be saved under its own id', async () =>
  {
    const reply = await call(vm.base, 'PUT', `/api/v1/scenes/${V0_SCENE.id}`, { cookie: alice, json: V0_SCENE })
    assert.equal(reply.status, 200)
    assert.equal(reply.body.id, V0_SCENE.id)
    assert.equal(reply.body.version, 1)
  })

  test('invalid and newer scenes are refused', async () =>
  {
    const post = (json) => call(vm.base, 'POST', '/api/v1/scenes', { cookie: alice, json })
    assert.equal((await post({ ...saved, version: 2 })).status, 422)
    assert.equal((await post({ ...saved, format: 'something.else' })).status, 400)
    const broken = await post({ ...saved, objects: [{ ...saved.objects[0], position: [1, 2] }] })
    assert.equal(broken.status, 400)
    assert.match(broken.body.error, /objects\/0\/position/)
    assert.equal((await post({ ...V0_SCENE, name: '   ' })).status, 400)
    assert.equal((await post([1, 2])).status, 400)
  })

  test('users only see their own scenes', async () =>
  {
    assert.equal((await call(vm.base, 'GET', `/api/v1/scenes/${saved.id}`, { cookie: bob })).status, 404)
    assert.equal((await call(vm.base, 'PUT', `/api/v1/scenes/${saved.id}`, { cookie: bob, json: V0_SCENE })).status, 404)
    assert.deepEqual((await call(vm.base, 'GET', '/api/v1/scenes', { cookie: bob })).body, [])
    const list = (await call(vm.base, 'GET', '/api/v1/scenes', { cookie: alice })).body
    assert.deepEqual(list.map((s) => s.id), [V0_SCENE.id, saved.id])
    assert.deepEqual(Object.keys(list[0]), ['id', 'name', 'updatedAt', 'objectCount'])
  })

  test('a team machine signs in and saves scenes through the VM', async () =>
  {
    const client = await startServer(tempDir('scenes-client'), { AUTH_MODE: 'client', AUTH_API_KEY: KEY, AUTH_ALLOW_HTTP: '1', VM_AUTH_URL: vm.base })
    try
    {
      const login = await call(client.base, 'POST', '/api/v1/auth/login', { json: { email: 'alice@example.com', password: PASSWORD } })
      assert.equal(login.status, 200, 'signed in through the VM\'s /api/v1/verify-account')
      const cookie = sessionCookie(login)
      assert.equal((await call(client.base, 'GET', '/api/v1/scenes', { cookie })).body.length, 2)
      const made = await call(client.base, 'POST', '/api/v1/scenes', { cookie, json: { ...V0_SCENE, id: undefined, name: 'From a team machine' } })
      assert.equal(made.status, 201)
      assert.deepEqual((await call(vm.base, 'GET', `/api/v1/scenes/${made.body.id}`, { cookie: alice })).body, made.body)
      assert.equal((await call(client.base, 'DELETE', `/api/v1/scenes/${made.body.id}`, { cookie })).status, 204)
      assert.equal((await call(client.base, 'DELETE', `/api/v1/scenes/${made.body.id}`, { cookie })).status, 404)
    }
    finally
    {
      await client.stop()
    }
  })
})
