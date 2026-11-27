# `backend/routes/feedback.js` and `routes/scenes.js`

Both store their data **in the VM's database**, alongside the accounts. A team machine passes these requests to the VM's `/library/...` versions of the same routes (`isForVm`/`askVm` in [library.js](../library.md)). A local-mode machine stores the data itself.

---

## `routes/feedback.js`

### `POST /feedback` (+ `/library/feedback`)
Signed-in accounts only (guests get 401). Body: `{ category: 'bug'|'idea'|'other', message }`.
1. `validateFeedback`, which gives 400 or 413 on a bad body.
2. `feedbackLimiter`: **10 per account per hour**, so one user cannot flood the table. Over the limit gives 429 with `Retry-After`.
3. **Client:** forwards `{ category, message, origin: machineName }` to the VM, or answers 503 *"feedback service is unavailable"*. The VM looks the sender up in its own database (`actAsUser`).
4. **Here:** `origin` is the client's value (up to 100 characters) on a `/library` call, otherwise this machine's name. `addFeedback` copies in the sender's email and name. The feedback is logged and the route returns **201 `{ id }`**.

### `GET /feedback` (+ `/library`)
`requireUser`, `requireAdmin`. This is the admins' read-only **Inbox**.
- `category` must be a known category; otherwise all categories are shown. `before` is a positive integer id used for *Load more*.
- **Client:** asks the VM with the same query. **The VM checks the role again in its own database**, so an out-of-date admin copy on a client machine cannot read the feedback.
- **Here:** `listFeedback({ category, before, limit: 50 })`, with dates in the shape the request's API version expects.

---

## `routes/scenes.js`
Saving and loading **Scene Builder** scenes (the endpoints `SceneStorage.js` uses). Each signed-in user sees **only their own scenes**. Scenes are saved in the versioned scene format ([services/scenes](../services/feedback-scenes-mail.md)): an older scene is converted when it is saved, and loading returns exactly what was saved.

- `SCENE_ID_RE = /^[\w-]{1,64}$/`. An invalid id gives 404.
- **`answeredByVm(req, res, method, vmPath)`**: on a team machine, passes the request (with the body for POST and PUT) to the VM and answers with the VM's reply. A 204 is answered with no body. Returns whether the request was handled this way.

| Route | Behaviour |
|---|---|
| `GET /scenes` | `listScenes(userId)`: `[{ id, name, updatedAt, objectCount }]`, newest first. |
| `POST /scenes` | `prepareScene(body, { id: randomUUID(), createdAt: now, now })`. 400 if it is not a valid scene, **422** if it is from a newer format version. `insertScene`. Returns **201** with the scene as saved. |
| `GET /scenes/:id` | `getScene(id, userId)` or 404. |
| `PUT /scenes/:id` | Keeps the existing `createdAt` if the scene exists. Updates an existing scene, or **creates it under that id if it is new**, so scenes kept in a browser can be moved into the account under their own ids. If the id belongs to **someone else's** scene, the insert fails on the unique key and the route answers 404. Returns 200 with the scene. |
| `DELETE /scenes/:id` | `deleteScene`. 404 if the user has no such scene, otherwise **204**. |
