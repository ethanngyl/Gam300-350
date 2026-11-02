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
(FeedbackScreen.jsx) and the admins' Inbox (FeedbackInbox.jsx). The ids
must match the backend's FEEDBACK_CATEGORIES (server.js).
- FEEDBACK_CATEGORIES
Each kind's id, label, icon and the placeholder shown in the form.
**************************************************************************/

export const FEEDBACK_CATEGORIES = [
    {
        id: 'bug',
        label: 'Bug report',
        icon: 'triangle',
        placeholder: 'What did you do, what did you expect, and what happened instead?',
    },
    {
        id: 'idea',
        label: 'Idea',
        icon: 'sparkle',
        placeholder: 'What would you like GENESIS to do, and what problem would it solve?',
    },
    {
        id: 'other',
        label: 'Other',
        icon: 'message',
        placeholder: 'Tell us what you think of GENESIS.',
    },
];
