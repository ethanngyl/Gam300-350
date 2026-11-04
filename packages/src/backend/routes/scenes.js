/*!************************************************************************
\file scenes.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
API layer: saving and loading Scene Builder scenes (the endpoints
SceneStorage.js expects). Each signed-in user sees only their own scenes.
A scene is saved in the versioned scene format (services/scenes.js); an
older scene is converted when saved, and loading returns exactly what was
saved. Scenes live in the VM's database, with the accounts: a team machine
passes these requests to the VM's /library/scenes twins.
- GET /scenes
The user's scenes, newest first: [{ id, name, updatedAt, objectCount }].
- POST /scenes
Saves a new scene (any format version) and returns it as saved.
- GET /scenes/:id, PUT /scenes/:id, DELETE /scenes/:id
Loads / saves (creating it under that id if new) / deletes one scene.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import crypto from 'node:crypto'
import express from 'express'
import { config } from '../config.js'
import { deleteScene, getScene, insertScene, listScenes, updateScene } from '../db.js'
import { forwardToVm } from '../library.js'
import { requireUser } from '../middleware/session.js'
import { clientAuthProblem } from '../services/authority.js'
import { prepareScene } from '../services/scenes.js'

const router = express.Router()
const SCENE_ID_RE = /^[\w-]{1,64}$/
const SCENES_UNAVAILABLE = { error: 'Saved scenes are unavailable. Try again shortly.' }

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    On a team machine (not the VM's /library twins), passes the request on
    to the VM as the signed-in user and answers with the VM's reply.
  \param req
    The request
  \param res
    The response
  \param method
    'GET' | 'POST' | 'PUT' | 'DELETE'
  \param vmPath
    string, e.g. '/library/scenes/<id>'
  \return
    true if the request was answered this way
*/
/************************************************************************/
async function answeredByVm(req, res, method, vmPath)
{
  if (config.authMode !== 'client' || req.path.startsWith('/library/')) return false
  if (clientAuthProblem())
  {
    res.status(503).json(SCENES_UNAVAILABLE)
    return true
  }
  const body = method === 'POST' || method === 'PUT' ? req.body : undefined
  const { status, data } = await forwardToVm(method, vmPath, req.user, body)
  if (status === 0) res.status(503).json(SCENES_UNAVAILABLE)
  else if (status === 204) res.status(204).end()
  else res.status(status).json(data)
  return true
}

// ----- Start of Routes ------------------------------------------------------ //

/************************************************************************/
/*!
  \brief
    The signed-in user's scenes, newest first.
  \return
    401 if not signed in, else [{ id, name, updatedAt, objectCount }]
*/
/************************************************************************/
router.get(['/scenes', '/library/scenes'], requireUser, async (req, res) => {
    if (await answeredByVm(req, res, 'GET', '/library/scenes')) return
    res.json(listScenes(req.user.id))
})

/************************************************************************/
/*!
  \brief
    Save a new scene. Body: a scene in any format version (an older one is
    converted); the server picks its id and dates.
  \return
    401 if not signed in, 400 if it isn't a valid scene, 422 if it is from
    a newer format version, else 201 and the scene as saved
*/
/************************************************************************/
router.post(['/scenes', '/library/scenes'], requireUser, async (req, res) => {
    if (await answeredByVm(req, res, 'POST', '/library/scenes')) return
    const now = Date.now()
    const { scene, status, error } = prepareScene(req.body, { id: crypto.randomUUID(), createdAt: now, now })
    if (error) return res.status(status).json({ error })
    insertScene(req.user.id, scene)
    res.status(201).json(scene)
})

/************************************************************************/
/*!
  \brief
    Load one of the user's scenes, exactly as it was saved.
  \return
    401 if not signed in, 404 if the user has no such scene, else the scene
*/
/************************************************************************/
router.get(['/scenes/:id', '/library/scenes/:id'], requireUser, async (req, res) => {
    if (!SCENE_ID_RE.test(req.params.id)) return res.status(404).json({ error: 'scene not found' })
    if (await answeredByVm(req, res, 'GET', `/library/scenes/${req.params.id}`)) return
    const scene = getScene(req.params.id, req.user.id)
    if (!scene) return res.status(404).json({ error: 'scene not found' })
    res.json(scene)
})

/************************************************************************/
/*!
  \brief
    Save one of the user's scenes. A new id creates it (so scenes kept in a
    browser can be moved to the account under their own ids); an id that
    belongs to someone else is not found.
  \return
    401 if not signed in, 400 if it isn't a valid scene, 404 if the id is
    someone else's, 422 if it is from a newer format version, else 200 and
    the scene as saved
*/
/************************************************************************/
router.put(['/scenes/:id', '/library/scenes/:id'], requireUser, async (req, res) => {
    const { id } = req.params
    if (!SCENE_ID_RE.test(id)) return res.status(404).json({ error: 'scene not found' })
    if (await answeredByVm(req, res, 'PUT', `/library/scenes/${id}`)) return
    const existing = getScene(id, req.user.id)
    const now = Date.now()
    const { scene, status, error } = prepareScene(req.body, { id, createdAt: existing?.createdAt ?? now, now })
    if (error) return res.status(status).json({ error })
    if (existing)
    {
        updateScene(req.user.id, scene)
        return res.json(scene)
    }
    try {
        insertScene(req.user.id, scene)
    }
    catch (err) {
        // The id is taken by another user's scene.
        if (/UNIQUE|PRIMARY KEY/i.test(err.message)) return res.status(404).json({ error: 'scene not found' })
        throw err
    }
    res.json(scene)
})

/************************************************************************/
/*!
  \brief
    Delete one of the user's scenes.
  \return
    401 if not signed in, 404 if the user has no such scene, else 204
*/
/************************************************************************/
router.delete(['/scenes/:id', '/library/scenes/:id'], requireUser, async (req, res) => {
    if (!SCENE_ID_RE.test(req.params.id)) return res.status(404).json({ error: 'scene not found' })
    if (await answeredByVm(req, res, 'DELETE', `/library/scenes/${req.params.id}`)) return
    if (!deleteScene(req.params.id, req.user.id)) return res.status(404).json({ error: 'scene not found' })
    res.status(204).end()
})

export default router
