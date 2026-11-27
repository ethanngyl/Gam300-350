# Web app: sign-in, account and feedback

---

## `LoginScreen.jsx`
The **log in / create account** screen, opened from the landing page's *Log in* (`#/login`) or *Get started* (`#/signup`). The layout follows the Genesis Figma: a hero panel on the left (hidden on narrow screens) and the form on the right. The GENESIS logo goes back to the landing page.

**Props:** `initialMode` (`signin` or `signup`), `onLogin(user)`, `onBackToLanding`.

### Constants
`GOOGLE_SIGN_IN_READY = true`, `GOOGLE_SIGN_IN_URL = '/api/v1/auth/google'`, `FORGOT_PASSWORD_URL`, `RESET_PASSWORD_URL`, `RESEND_AFTER_MS = 60 s` (matching the backend's one-request-a-minute limit), `MIN_PASSWORD_LENGTH = 6`.

### Functions
| Function | Behaviour |
|---|---|
| `postJson(url, body)` *(module)* | POSTs JSON and returns `{ ok, status, data }`. |
| `GoogleLogo({ size })` | The inline SVG mark. |
| `switchMode()` / `backToSignIn()` | Toggles between sign-in and create-account, and leaves the forgot-password steps. |
| **`continueWithGoogle()`** | Navigates the browser to `/api/v1/auth/google`. The backend's OAuth flow ends with a redirect back to `/` signed in, or `/?login=google_failed|google_denied`, which the screen explains. See [routes/auth](../../backend/routes/auth.md). |
| `handleForgotPassword()` | Switches the card to the two **forgot-password** steps. |
| **`requestResetCode()`** | `POST /auth/forgot-password { email }`. It always says the same thing whether or not the account exists (the backend does the same). A 429 shows the wait. It starts the 60 s resend cooldown. |
| **`submitNewPassword()`** | `POST /auth/reset-password { email, code, newPassword }`. On success it returns to Sign in with a *"Password changed"* note. A wrong or expired code shows the server's message. |
| `continueAsGuest()` | **Skips the backend.** It hands `onLogin` a local guest user (`isGuest: true`). Guests cannot save work or send feedback. |
| **`handleSubmit(e)`** | Checks the form shape first: email format, a password of at least 6 characters, and a name when creating an account. Then `POST /api/v1/auth/signup` or `/auth/login` with `{ name?, email, password, remember }`. The backend sets the **HttpOnly** session cookie. On success it calls `onLogin(user)`, and App caches the profile. The error shown is the server's (for example *"Incorrect email or password."* or the lockout). |

---

## `AccountScreen.jsx`
The **account settings**. A side menu (photo, name and plan at the top, the sections, *Log out* at the bottom) sits beside the chosen section. **On wide screens it opens as a window over the page it was opened from** (`isModal`; the X button or Escape closes it). On phones it is a page, and the menu becomes a row of tabs.

### Sections
| Section | Contents |
|---|---|
| **Profile** | Photo, name, plan and email; counts of models and photos; their models and photo batches from `GET /jobs`, which open the model page or the Library. |
| **My account** | Profile photo (stored in this browser by [ProfilePhoto.js](state-hooks.md#profilephotojs)); name; email; password (**Change password** opens `ChangePasswordDialog`; Google-only accounts, according to `GET /api/v1/auth/me/account`, have no password); sign-in methods; role; member since; *Show walkthrough*; log out; **Delete account** (type `DELETE` to confirm, then `DELETE /api/v1/auth/me`). Delete account is hidden while `DELETE_ACCOUNT_READY = false`, until the backend has that route. Guests see a sign-in card instead. |
| **Billing** | The current plan and this month's models. Paid plans are not available yet. |
| **Plans** | Free, Pro and Max compared side by side (a prototype). |
| **Storage** | The plan's storage, plus workspace statistics counted from `GET /jobs`. |
| **Notifications** | Which notifications the user wants (`NOTIFICATION_GROUPS`), saved in `localStorage` (`genesis-notification-prefs`). None are sent yet. |
| **Appearance** | Theme: dark, light or system (`setTheme`). |
| **Audio** | Sound effects on or off and the overall volume, then each kind of sound (`SOUND_CATEGORY_DETAILS`: buttons, camera shutter, notifications) on or off with its own volume and a *Play* button, all through [Audio.js](audio.md). |
| *Phone:* **Preferences** | Notifications, Appearance and Audio merged into one simpler tab (`PHONE_SECTION_GROUPS`). |

### Functions
- `loadNotificationPrefs()` / `saveNotificationPrefs(prefs)`: `localStorage`, wrapped in `try`.
- **`buildUsageStats(jobs)`**: turns the job list into the usage cards (models, photos, failed builds, the processing queue, and activity this week using `ONE_WEEK_MS`).
- **`AccountScreen({ user, isModal, onClose, onOpenModel, onOpenLibrary, onSignOut, onShowWalkthrough })`**: loads `GET /api/v1/jobs` and `GET /api/v1/auth/me/account`.
  - `setNotificationPref(id, channel, isOn)`;
  - `handlePhotoChosen(e)` (`saveProfilePhoto`);
  - `openSection(id)`;
  - `renderAvatar(className, iconSize)` (the photo or initials);
  - **`deleteAccount(typedWord)`** (requires `DELETE`, sends the request, then signs out);
  - `renderSignOutButton`, and one `render…Section` function for each section (`Account`, `Plans`, `SectionHeading`, `Profile`, `Billing`, `Storage`, `Notifications`, `ThemeOptions`, `SoundCard`, `Appearance`, `Audio`, `PhonePreferences`).

---

## `ChangePasswordDialog.jsx`
The *Change password* modal: current password, new password, and the new one again. It looks and behaves like [ActionDialog](components.md#actiondialogjsx) (Escape or the backdrop cancels, key presses stay inside the dialog, and it is disabled while saving). **The only check made here is that the two new passwords match.** Every other rule (length, not the same as before, the current password, the attempt limit) is the server's, and the server's message is shown as it comes back.
- `CHANGE_PASSWORD_URL = '/api/v1/auth/me/password'`. `errorMessage(res)` reads `{ error }`.
- `cancelWithSound()`, `handleKeyDown(e)`, **`handleSubmit(e)`**: POSTs `{ currentPassword, newPassword }` and calls `onChanged()` on success. The server signs out the account's other browsers, and this one stays signed in.

---

## `FeedbackScreen.jsx`
The **Feedback** page. Signed-in users choose a category (from [FeedbackCategories](utilities.md#feedbackcategoriesjs--trainingpresetsjs)), write a message and send it. Guests see a sign-in card instead, and the server refuses guests too (401).
- `MIN_MESSAGE_LENGTH` and `MAX_MESSAGE_LENGTH` come from the catalog.
- **`describeSendError(status, serverError)`**: friendly text for 401, 413, 429 (*"you've sent a lot of feedback"*), 503 and other errors.
- **`handleSubmit(e)`**: `POST /api/v1/feedback { category, message }`. The session cookie says who sent it. On success, a thank-you card with *Send more feedback* replaces the form.
- `renderLockedCard()`, `renderSentCard()`, `renderForm()`. A side card lists what makes feedback useful.
- **Admins** also get a *Send feedback | Inbox* switch that shows [FeedbackInbox](#feedbackinboxjsx). Other users never see it.

---

## `FeedbackInbox.jsx`
The admins' **read-only Inbox**. It lists feedback from `GET /feedback` (which answers 403 for anyone who is not an admin), newest first, **50 at a time with *Load more***. A filter shows all feedback or one category. Each message shows its category, when it was sent, the sender's name and email, and the machine it came from. **Messages are shown as plain text**, so HTML inside them is never rendered.
- `FILTERS` (*All* plus the categories), `EMPTY_TEXT` (an empty message for each filter).
- `describeLoadError(status)`: 401, 403 or other.
- **`fetchFeedbackPage(category, before)`**: builds the query string and returns `{ items, hasMore }`.
- `formatWhen(ms)`: a relative or short date.
- `loadFirstPage(category)`, `chooseFilter(category)`, `refresh()`, **`loadMore()`** (`before` is the id of the last item shown), `renderList()`.
