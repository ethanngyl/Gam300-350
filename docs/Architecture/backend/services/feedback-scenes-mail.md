# `backend/services/feedback.js`, `scenes.js`, `mail.js`

---

## `services/feedback.js`
The rules for feedback sent from the website. The categories and length limits are reference data from `catalog.json`.

- **`FEEDBACK_CATEGORIES`**: a `Set` of category ids (`bug`, `idea`, `other`).
- `MIN_FEEDBACK_LENGTH` / `MAX_FEEDBACK_LENGTH` come from `catalog.feedbackMessage`. `CATEGORY_LIST` is used in error messages, for example *"bug report, idea or other"*.
- **`validateFeedback(body)`**: returns `{ status: 400, error: 'Choose a category: …' }` for an unknown category, `{ status: 413 }` for a message that is too long, and `{ status: 400 }` for one that is too short. Otherwise it returns `{ category, message (trimmed) }`.

---

## `services/scenes.js`
The **saved scene format**. A scene is one JSON document that records its own format and version (`{ format: 'genesis.scene', version: 1, … }`, see `schemas/scene.v1.schema.json`). **Every scene is converted to the newest version before it is saved**, so loading returns exactly what was saved, and scenes from older builds still load.

Versions:
- **0**: the browser-only format `SceneStorage.js` kept in `localStorage`, with no `format` or `version` field.
- **1**: adds `format` and `version`, and every object field is required.

### Constants
`SCENE_FORMAT = 'genesis.scene'`, `SCENE_VERSION = 1`. Scene Builder defaults: background `#18181b`, render mode `splats`, trim `{ strength: 0, minOpacity: 0, maxSplatSize: 0, density: 0 }`. `UPGRADES = { 0: upgradeV0 }`; old converters are never removed.

### `upgradeV0(scene)` *(private)*
Adds `format` and `version: 1`, converts the dates with `toMs`, and fills in the background and render mode. Each object gets `objectId`, `jobId`, `name` (`''`), `position` (`[0,0,0]`), `rotation` (`[0,0,0]`), `scale` (`[1,1,1]`), the trim merged over the defaults, and `isHidden`. **Anything else is dropped**, for example the editor's `hasUnsavedChanges`.

### `upgradeScene(scene)` *(exported)*
- Not a plain object: 400 *"Send the scene as a JSON object."*
- No `format` and no `version` means version 0. A `format` other than `genesis.scene` gives 400.
- An invalid version gives 400. A version newer than this build gives **422** (*"saved by a newer version…"*).
- Otherwise it applies the converters one version at a time and returns `{ scene }`.

### `prepareScene(body, { id, createdAt, now })` *(exported)*
Upgrades the body, then sets the **server-chosen** `id`, `createdAt` and `updatedAt = now`, trims the name, and validates against `scene.v1`. Returns `{ scene }`, or 400 listing up to 5 problems.

---

## `services/mail.js`
Sends email (password-reset codes) with **nodemailer over SMTP**, for example a Gmail account with an app password. Only the VM, or a machine in local mode, sends email; team machines ask the VM. Emails are **plain text only**: no links, images or tracking.

### `mailReady()`
True when `MAIL_OUTBOX_DIR` is set, or when the SMTP host, user, password and `from` address are all set.

### `sendMail({ to, subject, text })`
Throws if mail is not set up.
- **With `MAIL_OUTBOX_DIR`** (tests and development): writes `<outbox>/<time>-<random>.json` containing `{ from, to, subject, text, sentAt }` instead of sending.
- Otherwise it creates the transport once and reuses it: port **465** uses TLS from the start, and any other port requires STARTTLS. Timeouts: 15 s to connect, 15 s for the greeting, 30 s for the socket. It resolves once the SMTP server has accepted the email.

### Command line
`node services/mail.js you@example.com` (`npm run mail:test -- you@example.com`) sends a test email to check the SMTP settings, and prints usage or setup hints if something is missing.
