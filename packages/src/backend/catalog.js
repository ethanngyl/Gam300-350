/*!************************************************************************
\file catalog.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
The website's reference data -- feedback categories, training presets, the
photo minimum -- lives in catalog/catalog.json (format:
schemas/catalog.schema.json), not in code. This file reads and checks it
once at startup; a broken catalog stops the backend with a message saying
what is wrong. CATALOG_FILE can point at another copy.
- catalog
The checked catalog (read-only).
- catalogForApi()
What GET /api/v1/catalog sends: the catalog plus the upload and training
limits from config, so a client needs no copies of either.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import { config } from './config.js'
import { validate } from './schemas.js'

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Reads and checks the catalog: its schema, then the rules a schema
    can't express (unique ids, the default preset exists, presets inside
    the server's iteration limits).
  \param file
    string
  \return
    The catalog object (frozen). Throws an Error naming every problem.
*/
/************************************************************************/
function loadCatalog(file)
{
  let data
  try
  {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  catch (err)
  {
    throw new Error(`catalog ${file} can't be read: ${err.message}`, { cause: err })
  }

  const problems = validate('catalog', data)
  if (problems.length === 0)
  {
    const uniqueIds = (list) => new Set(list.map((item) => item.id)).size === list.length
    if (!uniqueIds(data.feedbackCategories)) problems.push('feedbackCategories has the same id twice')
    if (!uniqueIds(data.trainingPresets)) problems.push('trainingPresets has the same id twice')
    if (!data.trainingPresets.some((preset) => preset.id === data.defaultTrainingPreset))
      problems.push(`defaultTrainingPreset "${data.defaultTrainingPreset}" is not one of trainingPresets`)
    for (const preset of data.trainingPresets)
    {
      if (preset.iterations < config.minTrainIters || preset.iterations > config.maxTrainIters)
        problems.push(`training preset "${preset.id}" is outside ${config.minTrainIters}-${config.maxTrainIters} iterations`)
    }
    if (data.feedbackMessage.minLength > data.feedbackMessage.maxLength)
      problems.push('feedbackMessage.minLength is above maxLength')
  }
  if (problems.length > 0) throw new Error(`catalog ${file} is not valid:\n  ${problems.join('\n  ')}`)

  return deepFreeze(data)
}

/************************************************************************/
/*!
  \brief
    Freezes an object and everything inside it, so no code changes the
    reference data by accident.
  \param value
    any
  \return
    the same value
*/
/************************************************************************/
function deepFreeze(value)
{
  if (value && typeof value === 'object')
  {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

export const catalog = loadCatalog(config.catalogFile)

/************************************************************************/
/*!
  \brief
    The catalog as the API sends it, with the limits that come from
    config (environment variables) added.
  \return
    { version, minPhotos, feedbackCategories, feedbackMessage,
      trainingPresets, defaultTrainingPreset, limits: { ... } }
*/
/************************************************************************/
export function catalogForApi()
{
  return {
    ...catalog,
    limits: {
      maxPhotos: config.maxFiles,
      maxPhotoSizeMB: config.maxFileSizeMB,
      maxMediaFiles: config.maxMediaFiles,
      maxMediaSizeMB: config.maxMediaSizeMB,
      maxFrameFps: config.frameMaxFps,
      minTrainIters: config.minTrainIters,
      maxTrainIters: config.maxTrainIters,
      maxAvatarKB: config.maxAvatarKB,
    },
  }
}
// ----- End of Functions ----------------------------------------------------- //
