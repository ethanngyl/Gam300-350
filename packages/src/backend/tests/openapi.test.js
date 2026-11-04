/*!************************************************************************
\file openapi.test.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
openapi.yaml is a valid OpenAPI document that describes exactly the routes
the server has, every operation has an example request and an example
response, every JSON example matches its schema, and the real server's
replies match what the document says (status and body shape).
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'
import SwaggerParser from '@apidevtools/swagger-parser'
import Ajv2020 from 'ajv/dist/2020.js'
import { BACKEND_DIR, SAMPLE_PHOTO, addJobFolder, call, isolatedEnv, openDb, signUp, startServer, tempDir } from './helpers.js'

const SPEC_FILE = path.join(BACKEND_DIR, 'openapi.yaml')
const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const spec = await SwaggerParser.dereference(SPEC_FILE)
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true })

// Every operation: { method, template, op, params }.
const operations = Object.entries(spec.paths).flatMap(([template, item]) =>
  METHODS.filter((m) => item[m]).map((m) => ({
    method: m.toUpperCase(),
    template,
    op: item[m],
    params: [...(item.parameters ?? []), ...(item[m].parameters ?? [])],
  })))

// Schemas from the shared files keep their own $schema / $id, which Ajv 2020
// doesn't need (and would look up); everything else is checked as written.
function cleanSchema(schema)
{
  if (Array.isArray(schema)) return schema.map(cleanSchema)
  if (!schema || typeof schema !== 'object') return schema
  return Object.fromEntries(Object.entries(schema).filter(([k]) => k !== '$schema' && k !== '$id').map(([k, v]) => [k, cleanSchema(v)]))
}
const validators = new Map()
function schemaProblems(schema, value)
{
  let check = validators.get(schema)
  if (!check)
  {
    check = ajv.compile(cleanSchema(schema))
    validators.set(schema, check)
  }
  return check(value) ? [] : check.errors.map((e) => `${e.instancePath || '/'} ${e.message}`)
}
const examplesOf = (media) => [
  ...(media.example !== undefined ? [media.example] : []),
  ...Object.values(media.examples ?? {}).map((e) => e.value),
]

// ----- Tests --------------------------------------------------------- //

describe('the document', () =>
{
  test('is valid OpenAPI 3.1', async () =>
  {
    const api = await SwaggerParser.validate(SPEC_FILE)
    assert.equal(api.openapi, '3.1.0')
    assert.equal(api.servers[0].url, '/api/v1')
  })

  test('documents exactly the routes the server registers', () =>
  {
    const run = spawnSync(process.execPath, [path.join(BACKEND_DIR, 'tests', 'print-routes.js')], {
      env: isolatedEnv(tempDir('routes')), encoding: 'utf8',
    })
    assert.equal(run.status, 0, run.stderr)
    const server = new Set(JSON.parse(run.stdout))
    const documented = new Set(operations.map((o) => `${o.method} ${o.template.replace(/\{(\w+)\}/g, ':$1')}`))
    assert.deepEqual([...server].filter((r) => !documented.has(r)), [], 'routes missing from openapi.yaml')
    assert.deepEqual([...documented].filter((r) => !server.has(r)), [], 'documented routes the server doesn\'t have')
  })

  test('every operation has a unique operationId, a summary and a tag', () =>
  {
    const ids = operations.map((o) => o.op.operationId)
    assert.equal(new Set(ids).size, ids.length)
    for (const { method, template, op } of operations)
      assert.ok(op.operationId && op.summary && op.tags?.length, `${method} ${template}`)
  })

  test('every example request: parameters and bodies have examples', () =>
  {
    for (const { method, template, op, params } of operations)
    {
      for (const param of params) assert.ok(param.example !== undefined, `${method} ${template}: parameter ${param.name} has no example`)
      for (const [type, media] of Object.entries(op.requestBody?.content ?? {}))
        assert.ok(examplesOf(media).length > 0, `${method} ${template}: request body ${type} has no example`)
    }
  })

  test('every operation has an example response', () =>
  {
    for (const { method, template, op } of operations)
    {
      const hasExample = Object.values(op.responses).some((response) =>
        Object.values(response.content ?? {}).some((media) => examplesOf(media).length > 0) ||
        Object.values(response.headers ?? {}).some((header) => header.example !== undefined))
      assert.ok(hasExample, `${method} ${template}: no example response`)
    }
  })

  test('every JSON example matches its schema', () =>
  {
    let checked = 0
    for (const { method, template, op } of operations)
    {
      const bodies = [
        ...Object.entries(op.requestBody?.content ?? {}).map(([type, media]) => ['request', type, media]),
        ...Object.entries(op.responses).flatMap(([status, response]) =>
          Object.entries(response.content ?? {}).map(([type, media]) => [status, type, media])),
      ]
      for (const [where, type, media] of bodies)
      {
        if (type !== 'application/json') continue
        for (const example of examplesOf(media))
        {
          assert.deepEqual(schemaProblems(media.schema, example), [], `${method} ${template} ${where} example`)
          checked++
        }
      }
    }
    assert.ok(checked > 100, `only ${checked} JSON examples checked`)
  })
})

describe('the server answers as documented', () =>
{
  const JOB = 'aaaaaaaa-1111-2222-3333-444444444444'
  let dir, server, cookie

  // The reply must be a documented status for that operation, and a JSON
  // body must match the documented schema (binary: a documented type).
  function expectDocumented(method, template, reply)
  {
    const op = spec.paths[template]?.[method.toLowerCase()]
    assert.ok(op, `${method} ${template} isn't documented`)
    const response = op.responses[String(reply.status)]
    assert.ok(response, `${method} ${template} answered ${reply.status}, which isn't documented`)
    const content = response.content ?? {}
    if (reply.type.includes('json'))
    {
      assert.ok(content['application/json'], `${method} ${template} ${reply.status}: JSON isn't documented`)
      assert.deepEqual(schemaProblems(content['application/json'].schema, reply.body), [], `${method} ${template} ${reply.status} body`)
    }
    else if (Object.keys(content).length > 0)
    {
      assert.ok(Object.keys(content).some((type) => reply.type.startsWith(type)), `${method} ${template}: ${reply.type} isn't documented`)
    }
  }
  async function check(method, urlPath, template, options)
  {
    const reply = await call(server.base, method, `/api/v1${urlPath}`, options)
    expectDocumented(method, template, reply)
    return reply
  }

  before(async () =>
  {
    dir = tempDir('contract')
    server = await startServer(dir, { JOB_SOURCES: 'live,sample' })
    ;({ cookie } = await signUp(server.base, { email: 'erin@example.com', name: 'Erin' }))
    addJobFolder(dir, JOB)
    const db = openDb(dir)
    db.prepare(`UPDATE users SET role = 'admin' WHERE email = 'erin@example.com'`).run()
    db.prepare('INSERT INTO jobs (id, owner_id) SELECT ?, id FROM users WHERE email = ?').run(JOB, 'erin@example.com')
    db.close()
  })
  after(() => server.stop())

  test('catalog and the document itself', async () =>
  {
    await check('GET', '/catalog', '/catalog')
    const yaml = await check('GET', '/openapi.yaml', '/openapi.yaml')
    assert.equal(yaml.body, fs.readFileSync(SPEC_FILE, 'utf8'))
  })

  test('auth and account', async () =>
  {
    await check('GET', '/auth/me', '/auth/me', { cookie })
    await check('PATCH', '/auth/me', '/auth/me', { cookie, json: { name: 'Erin Lee' } })
    await check('PATCH', '/auth/me', '/auth/me', { cookie, json: { name: '' } })
    await check('GET', '/auth/me/account', '/auth/me/account', { cookie })
    await check('GET', '/auth/me/storage', '/auth/me/storage', { cookie })
    await check('GET', '/auth/me/avatar', '/auth/me/avatar', { cookie })
    const jpeg = fs.readFileSync(SAMPLE_PHOTO).subarray(0, 4096)
    await check('PUT', '/auth/me/avatar', '/auth/me/avatar', { cookie, body: jpeg, headers: { 'Content-Type': 'image/jpeg' } })
    await check('GET', '/auth/me/avatar', '/auth/me/avatar', { cookie })
    await check('DELETE', '/auth/me/avatar', '/auth/me/avatar', { cookie })
    await check('POST', '/auth/me/password', '/auth/me/password', { cookie, json: { currentPassword: 'wrong-one', newPassword: 'another-password' } })
    await check('POST', '/auth/login', '/auth/login', { json: { email: 'erin@example.com', password: 'nope' } })
    await check('POST', '/auth/signup', '/auth/signup', { json: { name: 'X', email: 'not-an-email', password: 'abcdefgh' } })
  })

  test('jobs', async () =>
  {
    const list = await check('GET', '/jobs', '/jobs', { cookie })
    assert.ok(list.body.some((job) => job.id === JOB) && list.body.some((job) => job.id === 'sample-fox'))
    await check('GET', `/jobs/${JOB}`, '/jobs/{id}', { cookie })
    await check('GET', `/jobs/${JOB}/images/0000.jpg`, '/jobs/{id}/images/{name}', { cookie })
    await check('GET', `/jobs/${JOB}/images/9999.jpg`, '/jobs/{id}/images/{name}', { cookie })
    await check('GET', `/jobs/${JOB}/result.ply`, '/jobs/{id}/result.ply', { cookie })
    await check('GET', '/jobs/sample-fox/result.ply', '/jobs/{id}/result.ply', { cookie, headers: { Range: 'bytes=0-4095' } })
    await check('GET', `/jobs/${JOB}/cover.webp`, '/jobs/{id}/cover.webp', { cookie })
    await check('PATCH', `/jobs/${JOB}`, '/jobs/{id}', { cookie, json: { name: 'Renamed job' } })
    await check('DELETE', `/jobs/${JOB}`, '/jobs/{id}', { cookie })
    await check('POST', '/upload', '/upload', { cookie, body: new FormData() })
    await check('DELETE', `/jobs/${JOB}/files`, '/jobs/{id}/files', { cookie })
    await check('GET', `/jobs/${JOB}`, '/jobs/{id}', { cookie })
  })

  test('scenes', async () =>
  {
    const exampleScene = spec.components.requestBodies.SceneInput.content['application/json'].examples.version0.value
    const created = await check('POST', '/scenes', '/scenes', { cookie, json: exampleScene })
    assert.equal(created.status, 201)
    await check('GET', '/scenes', '/scenes', { cookie })
    await check('GET', `/scenes/${created.body.id}`, '/scenes/{id}', { cookie })
    await check('PUT', `/scenes/${created.body.id}`, '/scenes/{id}', { cookie, json: { ...created.body, name: 'Renamed scene' } })
    await check('POST', '/scenes', '/scenes', { cookie, json: { ...created.body, version: 2 } })
    await check('POST', '/scenes', '/scenes', { cookie, json: { ...created.body, renderMode: 'wireframe' } })
    await check('DELETE', `/scenes/${created.body.id}`, '/scenes/{id}', { cookie })
    await check('GET', `/scenes/${created.body.id}`, '/scenes/{id}', { cookie })
  })

  test('feedback, then signing out', async () =>
  {
    await check('POST', '/feedback', '/feedback', { cookie, json: { category: 'idea', message: 'Please add a dark mode toggle.' } })
    await check('POST', '/feedback', '/feedback', { cookie, json: { category: 'praise', message: 'Not a real category here.' } })
    await check('GET', '/feedback?category=idea', '/feedback', { cookie })
    await check('POST', '/auth/logout', '/auth/logout', { cookie })
    await check('GET', '/auth/me', '/auth/me', { cookie })
  })
})
