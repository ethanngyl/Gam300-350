/*!************************************************************************
\file metrics.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 07-11-2026
\brief
API layer: performance measurements (services/performance.js). Each machine
reports its own numbers; nothing is passed on to the VM.
- POST /metrics/page-load
The website reports how long it took to load in the browser (Navigation
Timing). Public, since the page loads before anyone signs in; at most 30
reports per IP address per minute.
- GET /metrics/performance
Admins: p50 / p95 / p99, mean, max and counts per API route and per
page-load measure, over the last hour, day or week.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import express from 'express'
import { createLimiter } from '../ratelimit.js'
import { requireAdmin, requireUser } from '../middleware/session.js'
import { limitByIp } from '../middleware/limits.js'
import { PAGE_LOAD_METRICS, REPORT_WINDOWS, performanceReport, recordTiming } from '../services/performance.js'

const router = express.Router()

// One report per page load, so 30 a minute from one address is plenty.
const pageLoadLimiter = createLimiter({ windowMs: 60 * 1000, max: 30 })
// Anything longer than this isn't a real page load (a tab left loading).
const MAX_PAGE_LOAD_MS = 120000

// ----- Start of Routes ------------------------------------------------------ //

/************************************************************************/
/*!
  \brief
    Record one page load. Body: any of { ttfb, fcp, domContentLoaded,
    load }, each in ms from 0 to 120000; other fields are ignored.
  \return
    204, 400 if no valid measure was sent, 429 if sending too often
*/
/************************************************************************/
router.post('/metrics/page-load', limitByIp(pageLoadLimiter), (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const valid = PAGE_LOAD_METRICS.filter((metric) => {
        const ms = body[metric]
        return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms <= MAX_PAGE_LOAD_MS
    })
    if (valid.length === 0)
        return res.status(400).json({ error: `Send at least one of ${PAGE_LOAD_METRICS.join(', ')}, in ms (0-${MAX_PAGE_LOAD_MS}).` })
    for (const metric of valid) recordTiming('page', metric, body[metric])
    res.status(204).end()
})

/************************************************************************/
/*!
  \brief
    The performance report. Query: window = 1h | 24h (default) | 7d.
  \return
    401 if not signed in, 403 if not an admin, 400 for another window,
    else the report (see performanceReport)
*/
/************************************************************************/
router.get('/metrics/performance', requireUser, requireAdmin, (req, res) => {
    const window = req.query.window ?? '24h'
    if (!Object.hasOwn(REPORT_WINDOWS, window))
        return res.status(400).json({ error: `window must be one of ${Object.keys(REPORT_WINDOWS).join(', ')}.` })
    res.json(performanceReport(window))
})

export default router
