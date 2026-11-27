/*!************************************************************************
\file PasswordRules.js
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 27-11-2026
\brief
The rules a new password must meet (creating an account, resetting a
forgotten password): at least 8 characters, an uppercase letter and a
special character. The server checks the same rules (passwordProblem in
backend/services/accounts.js); keep the two in step.
- PASSWORD_RULES
[{ id, label, test(password) }], in the order the sign-up checklist shows.
- passwordProblem(password)
A sentence naming every rule the password breaks, or null when it's fine.
**************************************************************************/

export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_RULES = [
    {
        id: 'length',
        label: `At least ${MIN_PASSWORD_LENGTH} characters`,
        test: (password) => password.length >= MIN_PASSWORD_LENGTH,
    },
    {
        id: 'upper',
        label: 'One uppercase letter',
        test: (password) => /\p{Lu}/u.test(password),
    },
    {
        // Anything that isn't a letter, digit or space, e.g. ! @ # $ % - _
        id: 'special',
        label: 'One special character (e.g. ! @ # $)',
        test: (password) => /[^\p{L}\p{N}\s]/u.test(password),
    },
];

const MISSING_TEXT = {
    length: `at least ${MIN_PASSWORD_LENGTH} characters`,
    upper: 'an uppercase letter',
    special: 'a special character (e.g. ! @ # $)',
};

export function passwordProblem(password) {
    const missing = PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => MISSING_TEXT[rule.id]);
    if (missing.length === 0) return null;
    const list = missing.length === 1
        ? missing[0]
        : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
    return `Password needs ${list}.`;
}
