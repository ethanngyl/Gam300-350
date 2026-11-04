/*!************************************************************************
\file schemas.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Checks data against the JSON Schema files in schemas/ (JSON Schema
draft-07, checked with Ajv). The schema files are the published formats
(docs/data-schema.md): catalog.json, the job summary the API lists,
status.json and the scene document. Checking against the same files the
docs point to keeps the two from drifting apart.
- validate(schemaName, data)
The problems with data (empty when it is valid). schemaName is a file in
schemas/ without .schema.json, e.g. 'scene.v1'.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const SCHEMAS_DIR = path.join(__dirname, 'schemas')

const ajv = new Ajv({ allErrors: true })
const compiled = new Map()

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Checks data against schemas/<schemaName>.schema.json (read and
    compiled once).
  \param schemaName
    string, e.g. 'catalog', 'scene.v1'
  \param data
    any
  \return
    string[], one readable line per problem ("/objects/0/position must
    NOT have fewer than 3 items"); empty when valid
*/
/************************************************************************/
export function validate(schemaName, data)
{
  let check = compiled.get(schemaName)
  if (!check)
  {
    const file = path.join(SCHEMAS_DIR, `${schemaName}.schema.json`)
    check = ajv.compile(JSON.parse(fs.readFileSync(file, 'utf8')))
    compiled.set(schemaName, check)
  }
  if (check(data)) return []
  return check.errors.map((err) => `${err.instancePath || '(top level)'} ${err.message}`)
}
// ----- End of Functions ----------------------------------------------------- //
