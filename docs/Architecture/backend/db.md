# `backend/db.js`

The **data layer**. Together with [dbstore.js](dbstore.md), it is the only code that contains SQL. It opens `data/app.db` with Node's built-in **`node:sqlite` `DatabaseSync`** (synchronous) and exposes plain functions that return camelCase objects with dates in milliseconds. Every statement is prepared once, when the module loads.

## Startup (module top level)
1. `mkdirSync(DATA_DIR)`, because `DatabaseSync` can create the file but not the folder.
2. `PRAGMA foreign_keys = ON`. SQLite ignores `REFERENCES` and `ON DELETE` unless this is set on each connection.
3. `PRAGMA journal_mode = WAL`, so reads (for example serving photos) do not block writes and the other way round. As a result, backups must use `VACUUM INTO`, not a file copy.
4. `PRAGMA journal_size_limit = 64 MB`. Storing a model is one large transaction, and this shrinks the WAL back afterwards.
5. **`await runMigrations(db, { backup: backupDatabase, log })`** ([migrate.js](migrate.md)). A database that already has tables is backed up first.
6. Deletes expired `sessions` and `password_resets`.

## Constants
- `SESSION_TTL_MS` = 7 days ("Remember me"). `SHORT_SESSION_TTL_MS` = 24 h. That is the server-side limit when *Remember me* is off; the cookie itself is a session cookie that ends when the browser closes.
- `NO_PASSWORD_HASHES = {'google-sso', 'remote'}`: placeholder hashes for Google-only accounts and for copies of VM accounts on client machines.
- `MODEL_CHUNK_BYTES` = 4 MB. Stored per model, so changing it later does not break models already stored.

## Passwords and users
| Function | Behaviour |
|---|---|
| `userFromRow(row)` *(private)* | Maps a row to `{ id, email, name, role, createdAt }`, plus `passwordHash` where needed. |
| `hashPassword(pw)` | **scrypt** with a fresh 16-byte random salt and a 64-byte key. Returns `"saltHex:hashHex"`. |
| `verifyPassword(pw, stored)` | Splits `salt:hash` (a malformed value is false), runs scrypt to the same length, and compares with **`crypto.timingSafeEqual`**. |
| `createUser({email, name, password})` | Inserts a user with the hashed password and role `user`. A UNIQUE violation throws `code: 'EMAIL_TAKEN'`. |
| `findUserByEmail(email)` | Includes `passwordHash`. The email column is case-insensitive (`COLLATE NOCASE` in the schema). |
| `findUserById(id)` | On the VM, used to act as the user a client machine names, with the role taken from the VM's own database. |
| `upsertLocalUser({id, email, name, role})` | **Client mode:** mirrors a user the VM authenticated, using the **VM's id**, so sessions and job ownership work. In one transaction, it deletes any other row with the same email (a stale copy) and upserts with `password_hash 'remote'`. No password is ever stored locally. |
| `retireLocalAccounts()` | For a machine switching to client mode: if any non-`remote` accounts exist, it backs up the database, then deletes them. Foreign keys delete their sessions and make their jobs ownerless (admin-only). Returns `{ removed, backupPath }`. |
| `findOrCreateGoogleUser({sub, email, name})` | Matches (1) by `google_sub`, (2) by email, which **links** the Google id **and cancels the old password and logs out every session** in one transaction (sign-up never proves email ownership, so this stops "pre-hijacking"), or (3) creates a new `google-sso` account. Returns `null` if the email is already linked to a *different* Google id. |

## Sessions
| Function | Behaviour |
|---|---|
| `hashToken(token)` *(private)* | SHA-256 hex. **Only the hash is stored**, so reading the database does not hand out working logins. |
| `createSession(userId, ttlMs)` | 32 random bytes as a base64url token. Inserts the hash with `expires_at` and returns the **raw** token for the cookie. |
| `findSessionUser(token)` | Joins sessions to users where the hash matches and the session has not expired. Returns the user or `null`. |
| `deleteSession(token)` | Logout. |
| `endOtherSessions(userId, keepToken)` | Deletes every session except `keepToken`'s (or all, if `keepToken` is null). Returns the number removed. Used after a password change. |

## Job ownership and the shared library
| Function | Behaviour |
|---|---|
| `setJobOwner(jobId, userId)` | Upserts `jobs(id, owner_id)`. |
| `getJobOwnerId(jobId)` | Returns the owner id or `null`. |
| `listOwnedJobIds(userId)` | Returns a `Set` of job ids. |
| `recordStoredJob(jobId, ownerId, origin, bytes)` | **VM:** records a job received from a client machine: its owner (`null` means admin-only), which machine sent it, and its size. |
| `markJobSynced` / `unmarkJobSynced` / `isJobSynced` | **Client:** the `synced_jobs` table lists finished jobs the VM has already received, so each one is sent once. It is a separate table because old jobs may have no `jobs` row. |
| `getDbJobBytes(jobId)` | The size of the job's photos plus its model in the database. |

## Photos and models in the database (VM with `FILE_STORE=db`)
| Function | Behaviour |
|---|---|
| `storeJobImages(jobId, dir)` | In **one transaction**: `INSERT OR IGNORE jobs(id)` (an existing row keeps its owner), deletes the old images, then inserts every JPEG and PNG, read **one at a time** to keep memory low. Returns `{ count, bytes }`. It throws and rolls back on failure, and the caller then keeps the folder. |
| `listDbImageNames(jobId)` | Sorted names. |
| `getDbImage(jobId, name)` | `{ mime, size, data: Buffer }`. The BLOB arrives as a `Uint8Array` and is wrapped as a Buffer without copying. |
| `hasDbImages()` / `hasDbModels()` | Whether any are stored. |
| `deleteDbImages(jobId)` / `deleteDbModel(jobId)` | Removes them. The model's chunks are deleted with it. |
| `storeJobModel(jobId, filePath)` | Reads the `.ply` **4 MB at a time** into `job_model_chunks(seq)` and records `job_models(size, chunk_size, stored_at)`, all in one transaction. It throws if the file shrinks while being read. It is **synchronous on purpose**: the backend shares one connection, so an `await` inside the transaction would let other requests' writes land in it and be rolled back with it. |
| `getDbModelInfo(jobId)` | `{ size, chunkSize, storedAt }` or `null`. |
| `readDbModelChunk(jobId, seq)` | One chunk as a Buffer, or `null`. Chunks let a byte-range request (for example the viewer's 4 KB header read) read only what it needs. |

## Backups
**`backupDatabase()`** runs `VACUUM INTO data/app.db.bak-<ISO time>`, a consistent copy that is safe while the backend runs. Returns the backup path.

## Feedback
| Function | Behaviour |
|---|---|
| `addFeedback({userId, email, name, category, message, origin})` | The email and name are **copied in**, so the message still shows who sent it after the account is deleted. Returns the new id. |
| `listFeedback({category, before, limit = 50})` | Newest first, optionally filtered by category, with **cursor paging** by `id < before`. It fetches `limit + 1` rows to know `hasMore`. Returns `{ items, hasMore }`. |
| `deleteOldFeedback(days)` | Deletes messages older than `days` and returns the count. |

## Account page
| Function | Behaviour |
|---|---|
| `getAccount(userId)` | `{ id, email, name, role, createdAt, hasPassword, hasGoogle, passwordChangedAt, avatarUpdatedAt }`. It never returns the hash itself. |
| `updateUserName(userId, name)` | Updates the display name. |
| `setUserPassword(userId, pw)` | Hashes the password and records `password_changed_at`. |
| `setUserAvatar(userId, mime, data)` | Upserts the photo. `updated_at = max(now, previous + 1)`, so it **always increases** and doubles as a cache-busting version. Returns that value. |
| `getUserAvatar(userId)` / `deleteUserAvatar(userId)` | Read or delete the photo. |

## Scenes (documents checked in [services/scenes](services/scenes.md))
| Function | Behaviour |
|---|---|
| `listScenes(ownerId)` | `[{ id, name, updatedAt, objectCount }]`, newest first. SQLite counts the objects with `json_array_length(document, '$.objects')`, so a list never parses whole scenes. |
| `getScene(id, ownerId)` | The parsed document, or `null`. |
| `insertScene(ownerId, scene)` / `updateScene(ownerId, scene)` | Store the JSON as given. `updateScene` returns false if the user has no such scene. |
| `deleteScene(id, ownerId)` | Returns true if a row was deleted. |

## Performance summaries ([services/performance](services/performance.md))
| Function | Behaviour |
|---|---|
| `addPerfMinutes(rows)` | In one transaction, **adds** each row to any existing `(kind, name, minute)` row (counts, errors, sums, maximum, and bucket arrays element by element) instead of replacing it, so minutes written partly before a restart are kept. |
| `listPerfMinutes(since)` | Rows from `since` onwards, with buckets parsed. |
| `deletePerfOlderThan(before)` | Returns the number of rows deleted. |

## Password-reset codes ([services/passwordReset](services/passwordReset.md))
| Function | Behaviour |
|---|---|
| `savePasswordReset(userId, codeHash, expiresAt)` | One code per user. An upsert resets `attempts` to 0. Only the hash is stored. |
| `getPasswordReset(userId)` | `{ codeHash, expiresAt, attempts, createdAt }` or `null`. |
| `countResetAttempt(userId)` | Increments the attempt count with `RETURNING` and returns it (0 if there is no code). |
| `deletePasswordReset(userId)` | Removes the code. |
