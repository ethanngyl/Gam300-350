/*!************************************************************************
\file scenes.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Business logic: the saved scene format. A scene is one JSON document that
records its own format and version ({ format: 'genesis.scene', version: 1,
... }, schemas/scene.v1.schema.json). Every scene is converted to the
newest version before it is saved, so loading returns exactly what was
saved, and a scene from an older build still loads. No req / res.
Versions:
  0 -- the browser-only format SceneStorage.js kept in localStorage (no
       format or version field)
  1 -- adds format and version; every object field is required
- SCENE_FORMAT / SCENE_VERSION
What this build writes.
- upgradeScene(document)
Converts a scene of any older version to the newest, one version at a time.
- prepareScene(body, { id, createdAt, now })
Turns a request body into the document to save: upgraded, with the
server's id and dates, and checked against the schema.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { validate } from '../schemas.js'
import { toMs } from '../adapters/apiVersions.js'

export const SCENE_FORMAT = 'genesis.scene'
export const SCENE_VERSION = 1

// The Scene Builder's defaults (SceneBuilderScreen.jsx / SceneStorage.js),
// for fields an older scene leaves out.
const DEFAULT_BACKGROUND = '#18181b'
const DEFAULT_RENDER_MODE = 'splats'
const DEFAULT_TRIM = { strength: 0, minOpacity: 0, maxSplatSize: 0, density: 0 }

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Version 0 -> 1: adds format / version, fills in the fields version 0
    could leave out, and drops anything that isn't part of a scene (e.g.
    the editor's hasUnsavedChanges).
  \param scene
    A version 0 scene
  \return
    A version 1 scene (not yet checked)
*/
/************************************************************************/
function upgradeV0(scene)
{
  const objects = Array.isArray(scene.objects) ? scene.objects : []
  return {
    format: SCENE_FORMAT,
    version: 1,
    id: scene.id,
    name: scene.name,
    createdAt: toMs(scene.createdAt),
    updatedAt: toMs(scene.updatedAt),
    background: scene.background ?? DEFAULT_BACKGROUND,
    renderMode: scene.renderMode ?? DEFAULT_RENDER_MODE,
    objects: objects.map((object) => ({
      objectId: object?.objectId,
      jobId: object?.jobId,
      name: object?.name ?? '',
      position: object?.position ?? [0, 0, 0],
      rotation: object?.rotation ?? [0, 0, 0],
      scale: object?.scale ?? [1, 1, 1],
      trim: { ...DEFAULT_TRIM, ...(object?.trim ?? {}) },
      isHidden: object?.isHidden === true,
    })),
  }
}

// Converters by the version they start from. A new format version adds one
// here (and a schemas/scene.v<N>.schema.json); old ones are never removed.
const UPGRADES = { 0: upgradeV0 }

/************************************************************************/
/*!
  \brief
    Brings a scene of any known version up to SCENE_VERSION.
  \param scene
    object
  \return
    { scene } converted, or { status, error }: 400 if it isn't a scene,
    422 if it was saved by a newer build than this one
*/
/************************************************************************/
export function upgradeScene(scene)
{
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return { status: 400, error: 'Send the scene as a JSON object.' }
  const isVersion0 = scene.format === undefined && scene.version === undefined
  if (!isVersion0 && scene.format !== SCENE_FORMAT) return { status: 400, error: `This is not a ${SCENE_FORMAT} document.` }
  let version = isVersion0 ? 0 : scene.version
  if (!Number.isInteger(version) || version < 0) return { status: 400, error: 'The scene has no valid version number.' }
  if (version > SCENE_VERSION)
    return { status: 422, error: `This scene was saved by a newer version (format ${version}; this server reads up to ${SCENE_VERSION}).` }

  let upgraded = scene
  while (version < SCENE_VERSION)
  {
    upgraded = UPGRADES[version](upgraded)
    version = upgraded.version
  }
  return { scene: upgraded }
}

/************************************************************************/
/*!
  \brief
    The document to save for a create or update: the body upgraded to the
    newest version, with the id and dates the server decides, then checked
    against schemas/scene.v1.schema.json.
  \param body
    The request body (a scene of any version)
  \param id
    string, the scene's id
  \param createdAt
    number (ms), when it was first saved
  \param now
    number (ms)
  \return
    { scene } ready to store, or { status, error }
*/
/************************************************************************/
export function prepareScene(body, { id, createdAt, now })
{
  const upgraded = upgradeScene(body)
  if (upgraded.error) return upgraded
  const scene = { ...upgraded.scene, id, createdAt, updatedAt: now }
  if (typeof scene.name === 'string') scene.name = scene.name.trim()
  const problems = validate(`scene.v${SCENE_VERSION}`, scene)
  if (problems.length > 0) return { status: 400, error: `The scene is not valid: ${problems.slice(0, 5).join('; ')}` }
  return { scene }
}
// ----- End of Functions ----------------------------------------------------- //
