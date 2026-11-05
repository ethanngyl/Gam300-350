/*!************************************************************************
\file catalog.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
API layer: GET /catalog, the website's reference data (feedback
categories, training presets, the photo minimum, upload limits), so a
client reads them instead of keeping its own copies. See catalog.js.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import express from 'express'
import { catalogForApi } from '../catalog.js'

const router = express.Router()

// ----- Start of Routes ------------------------------------------------------ //

/************************************************************************/
/*!
  \brief
    The reference data. Public: the sign-in page can use it too.
  \return
    200 { version, minPhotos, feedbackCategories, feedbackMessage,
    trainingPresets, defaultTrainingPreset, limits }
*/
/************************************************************************/
router.get('/catalog', (_req, res) => {
    res.json(catalogForApi())
})

export default router
