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
Business logic: the rules for feedback sent from the website. No req / res.
Moved out of server.js.
- FEEDBACK_CATEGORIES
'bug', 'idea' and 'other'.
- validateFeedback(body)
Checks the category and the message length.
**************************************************************************/

// --- Feedback ------------------------------------------------------------------
// Kept in step with FeedbackScreen.jsx (its categories and length limits).
export const FEEDBACK_CATEGORIES = new Set(['bug', 'idea', 'other'])
const MIN_FEEDBACK_LENGTH = 10
const MAX_FEEDBACK_LENGTH = 1000

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Checks a feedback body.
  \param body
    { category, message }
  \return
    { status, error } if invalid (413 if the message is too long, else
    400), else { category, message } with the message trimmed
*/
/************************************************************************/
export function validateFeedback(body) {
    const { category, message } = body || {}
    const trimmed = typeof message === 'string' ? message.trim() : ''
    if (!FEEDBACK_CATEGORIES.has(category))
        return { status: 400, error: 'Choose a feedback type: bug report, idea or other.' }
    if (trimmed.length > MAX_FEEDBACK_LENGTH)
        return { status: 413, error: `Keep your message under ${MAX_FEEDBACK_LENGTH} characters.` }
    if (trimmed.length < MIN_FEEDBACK_LENGTH)
        return { status: 400, error: `Write at least ${MIN_FEEDBACK_LENGTH} characters.` }
    return { category, message: trimmed }
}
