/*!************************************************************************
\file docs.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
API layer: GET /openapi.yaml, the API's own description (OpenAPI 3.1,
openapi.yaml next to this folder) with an example request and response for
every endpoint. Public data: open it in Swagger Editor or Redoc to browse.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import path from 'node:path'
import express from 'express'
import { fileURLToPath } from 'node:url'

const router = express.Router()
const OPENAPI_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'openapi.yaml')

// ----- Start of Routes ------------------------------------------------------ //

/************************************************************************/
/*!
  \brief
    The OpenAPI document.
  \return
    200 application/yaml
*/
/************************************************************************/
router.get('/openapi.yaml', (_req, res) => {
    res.type('application/yaml')
    res.sendFile(OPENAPI_FILE)
})

export default router
