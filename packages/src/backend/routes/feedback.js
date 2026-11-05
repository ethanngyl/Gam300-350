/*!************************************************************************
\file feedback.js
\author1 Gabriel Sebastian Putra
\author2 Xiong Yang
\author3 Ethan Ng
\par DP email1: gabrielsebastian.p@digipen.edu
\par DP email2: xiong.yang@digipen.edu
\par DP email3: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
API layer: feedback from the website. Moved out of server.js.
- POST /feedback
Signed-in accounts only (guests get 401), at most 10 per account per hour.
Stored in the VM's database: client machines forward it to the VM's
/library/feedback.
- GET /feedback
The admins' read-only Inbox (requireAdmin: 403 for everyone else).
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import express from 'express'
import { config } from '../config.js'
import { addFeedback, listFeedback } from '../db.js'
import { askVm, isForVm } from '../library.js'
import { createLimiter } from '../ratelimit.js'
import { requireAdmin, requireUser } from '../middleware/session.js'
import { tooManyAttempts } from '../middleware/limits.js'
import { FEEDBACK_CATEGORIES, validateFeedback } from '../services/feedback.js'
import { feedbackPageFor, toV1FeedbackPage } from '../adapters/apiVersions.js'

const router = express.Router()

// A team machine's reply when the VM can't be reached.
const FEEDBACK_UNAVAILABLE = { error: 'The feedback service is unavailable. Try again shortly.' }
// Per account, so one user can't flood the table.
const feedbackLimiter = createLimiter({ windowMs: 60 * 60 * 1000, max: 10 })

// ----- Start of Routes ------------------------------------------------------ //

/************************************************************************/
/*!
  \brief
    Send feedback from the website's Feedback page. Body: { category:
    'bug' | 'idea' | 'other', message }. Signed-in accounts only (users
    and admins): guests have no session, so they get 401. Feedback always
    ends up in the VM's database: the VM stores it; a client machine
    forwards it to the VM's /library/feedback, where the VM looks the
    sender up in its own database (actAsUser); a 'local' machine (no VM)
    stores it in its own database. At most 10 per account per hour.
  \return
    401 if not logged in, 400 / 413 on a bad body, 429 if sending too
    often, 503 if the VM can't be reached (client machine), else 201 { id }
*/
/************************************************************************/
router.post(['/feedback', '/library/feedback'], requireUser, async (req, res) => {
    const checked = validateFeedback(req.body)
    if (checked.error) return res.status(checked.status).json({ error: checked.error })

    const { allowed, retryAfterSec } = feedbackLimiter.hit(`user:${req.user.id}`)
    if (!allowed) {
        res.set('Retry-After', String(retryAfterSec))
        return res.status(429).json({ error: tooManyAttempts(retryAfterSec) })
    }

    const fromClientMachine = req.path.startsWith('/library/')
    if (isForVm(req)) {
        const { status, data } = await askVm(req, 'POST', '/library/feedback', {
            body: { ...checked, origin: config.machineName },
            unavailable: FEEDBACK_UNAVAILABLE,
        })
        return res.status(status).json(data)
    }

    const origin = fromClientMachine
        ? (typeof req.body.origin === 'string' ? req.body.origin.slice(0, 100) : null)
        : config.machineName
    const id = addFeedback({
        userId: req.user.id,
        email: req.user.email,
        name: req.user.name,
        category: checked.category,
        message: checked.message,
        origin,
    })
    console.log(`[backend] feedback #${id} (${checked.category}) from ${req.user.email}${origin ? ` on ${origin}` : ''}`)
    res.status(201).json({ id })
})

const FEEDBACK_PAGE_SIZE = 50

/************************************************************************/
/*!
  \brief
    The admins' feedback Inbox: one page of feedback, newest first.
    Query: category ('bug' | 'idea' | 'other'; anything else means all)
    and before (an id: only older messages, for "Load more"). Admins only.
    A client machine asks the VM's /library/feedback, and the VM checks
    the role again in its own database, so a stale admin copy on a client
    machine can't read it.
  \return
    401 if not logged in, 403 if not an admin, 503 if the VM can't be
    reached (client machine), else { items, hasMore } (see listFeedback)
*/
/************************************************************************/
router.get(['/feedback', '/library/feedback'], requireUser, requireAdmin, async (req, res) => {
    const category = FEEDBACK_CATEGORIES.has(req.query.category) ? req.query.category : null
    const beforeNumber = Number(req.query.before)
    const before = Number.isInteger(beforeNumber) && beforeNumber > 0 ? beforeNumber : null

    if (isForVm(req)) {
        const query = new URLSearchParams()
        if (category) query.set('category', category)
        if (before) query.set('before', String(before))
        const { status, data } = await askVm(req, 'GET', `/library/feedback?${query}`, { unavailable: FEEDBACK_UNAVAILABLE })
        return res.status(status).json(feedbackPageFor(req, toV1FeedbackPage(data)))
    }

    res.json(feedbackPageFor(req, listFeedback({ category, before, limit: FEEDBACK_PAGE_SIZE })))
})

export default router
