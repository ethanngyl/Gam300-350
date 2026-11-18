/*!************************************************************************
\file simulatedUser.js
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-11-2026
\brief
One simulated user's visit, for the concurrency test (concurrency.test.js)
and the load test (load-test.js, npm run load). Each user comes from their
own IP address (X-Forwarded-For; the server must run with TRUST_PROXY=true,
as on the VM behind Caddy), so the per-address limits treat them as
different people.
- userIp(index)
A distinct private address for user number index.
- runUserSession(base, index, onCall)
Signs up, reads their account, the catalog and their jobs, creates /
lists / edits / reads / deletes a scene, sends feedback and signs out.
Checks every reply (status, and that the scene list only holds their own
scene). Resolves to { ok, errors[] }; never throws.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { call, sessionCookie } from './helpers.js'

// A scene as the website saves it (format version 0, converted by the server).
function sceneFor(index)
{
  return {
    name: `Load test scene ${index}`,
    background: '#202020',
    renderMode: 'points',
    objects: [
      { objectId: 'obj-1', jobId: 'sample-fox', name: 'Fox', position: [1, 0, -2.5], rotation: [0, 90, 0], scale: [1, 1, 1] },
    ],
  }
}

// ----- Start of Functions --------------------------------------------------- //

export function userIp(index)
{
  return `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`
}

/************************************************************************/
/*!
  \brief
    One user's visit. Every request is timed and checked; a wrong status
    or a reply that shows another user's data is recorded as an error.
  \param base
    string, the server's address
  \param index
    number, unique per user
  \param onCall
    optional (route, ms, status) => void, for timings
  \return
    Promise of { ok: boolean, errors: string[] }
*/
/************************************************************************/
export async function runUserSession(base, index, onCall = () => {})
{
  const errors = []
  const headers = { 'X-Forwarded-For': userIp(index) }
  let cookie = null

  // One request; records an error (and returns null) if the status isn't expected.
  const step = async (route, method, path, expected, json) =>
  {
    const start = performance.now()
    let reply
    try
    {
      reply = await call(base, method, path, { cookie, json, headers })
    }
    catch (error)
    {
      errors.push(`${route}: ${error.message}`)
      onCall(route, performance.now() - start, 0)
      return null
    }
    onCall(route, performance.now() - start, reply.status)
    if (reply.status !== expected)
    {
      errors.push(`${route}: HTTP ${reply.status} (expected ${expected}) ${JSON.stringify(reply.body).slice(0, 120)}`)
      return null
    }
    return reply
  }

  const email = `load-user-${index}@example.test`
  const signup = await step('POST /auth/signup', 'POST', '/api/v1/auth/signup', 201,
    { name: `Load User ${index}`, email, password: `load-test-password-${index}` })
  cookie = signup && sessionCookie(signup)
  if (!cookie) return { ok: false, errors: errors.length ? errors : ['POST /auth/signup: no session cookie'] }

  const me = await step('GET /auth/me', 'GET', '/api/v1/auth/me', 200)
  if (me && me.body.email !== email) errors.push(`GET /auth/me: got ${me.body.email}, expected ${email}`)

  await step('GET /catalog', 'GET', '/api/v1/catalog', 200)
  await step('GET /jobs', 'GET', '/api/v1/jobs', 200)

  const created = await step('POST /scenes', 'POST', '/api/v1/scenes', 201, sceneFor(index))
  const sceneId = created?.body?.id
  if (sceneId)
  {
    // Under load, each user must still see exactly their own scene.
    const list = await step('GET /scenes', 'GET', '/api/v1/scenes', 200)
    if (list && (list.body.length !== 1 || list.body[0].id !== sceneId))
    {
      errors.push(`GET /scenes: expected only scene ${sceneId}, got ${JSON.stringify(list.body.map((s) => s.id))}`)
    }
    const edited = { ...created.body, name: `Edited scene ${index}` }
    await step('PUT /scenes/:id', 'PUT', `/api/v1/scenes/${sceneId}`, 200, edited)
    const read = await step('GET /scenes/:id', 'GET', `/api/v1/scenes/${sceneId}`, 200)
    if (read && read.body.name !== edited.name) errors.push(`GET /scenes/:id: name is "${read.body.name}", expected "${edited.name}"`)
  }

  await step('POST /feedback', 'POST', '/api/v1/feedback', 201,
    { category: 'idea', message: `Load test feedback from user ${index}.` })
  if (sceneId) await step('DELETE /scenes/:id', 'DELETE', `/api/v1/scenes/${sceneId}`, 204)
  await step('POST /auth/logout', 'POST', '/api/v1/auth/logout', 204)
  await step('GET /auth/me (signed out)', 'GET', '/api/v1/auth/me', 401)

  return { ok: errors.length === 0, errors }
}
// ----- End of Functions ----------------------------------------------------- //
