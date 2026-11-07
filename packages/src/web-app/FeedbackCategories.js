/*!************************************************************************
\file FeedbackCategories.js
\author1 Bryan Lim Jun Jie
\author2 Gabriel Sebastian Putra
\par DP email1: bryanjunjie.lim@digipen.edu
\par DP email2: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 31-10-2026
\brief
The kinds of feedback, shared by the Feedback page's form
(FeedbackScreen.jsx) and the admins' Inbox (FeedbackInbox.jsx). They are
reference data in the backend's catalog/catalog.json, read through
GET /api/v1/catalog (catalog.js), so the website and the backend can't
disagree.
- FEEDBACK_CATEGORIES
Each kind's id, label, icon and the placeholder shown in the form.
- FEEDBACK_MESSAGE
{ minLength, maxLength } of a feedback message.
**************************************************************************/

import { catalog } from './catalog.js';

export const FEEDBACK_CATEGORIES = catalog.feedbackCategories;

export const FEEDBACK_MESSAGE = catalog.feedbackMessage;
