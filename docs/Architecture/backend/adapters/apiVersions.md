# `backend/adapters/apiVersions.js`

*Author: Gabriel.* The adapter between the **two API versions** the backend answers (see `docs/api-changelog.md`). The same routes are mounted at **`/api/v1/...`** and at the old unversioned **legacy** paths, which are kept unchanged for the website, the engine and older machines.

Inside the backend everything uses the v1 shape, with **dates as UTC epoch milliseconds**. Only users, account details and feedback differ between versions: the legacy API sends their dates as **ISO 8601 text**. Replies from the VM can arrive in either shape (an older VM, or the legacy paths machines use to talk to each other), so the `toV1…` functions accept both.

## Constants
- `API_V1_PREFIX = '/api/v1'`. The engine's [BackendClient](../../engine/net/BackendClient.md) must use the same value.
- `LEGACY_DEPRECATED_AT`: 2026-11-03 00:00 UTC, in seconds, for the `Deprecation` header.

## Functions
| Function | Behaviour |
|---|---|
| `isLegacy(req)` | True when `req.baseUrl` is not `/api/v1`. `baseUrl` is where the router was mounted. |
| `toMs(value)` | A number is kept if finite. ISO text is parsed. SQLite's `"YYYY-MM-DD HH:MM:SS"` (UTC, no zone) becomes `…T…Z` before parsing. Returns `null` if the value is missing or unreadable. |
| `toIso(ms)` | `"2026-10-04T08:15:00Z"`: UTC to the **second**, without milliseconds, because the database used to store whole seconds and legacy clients never saw milliseconds. |
| `toV1User(user)` | `createdAt` and `memberSince` converted to milliseconds. |
| `toV1Account(account)` | `createdAt` and `passwordChangedAt` converted to milliseconds. Returned unchanged if there is no email (for example an `{ error }` reply). |
| `toV1FeedbackPage(page)` | Each item's `createdAt` converted to milliseconds. |
| `userFor(req, user)`, `accountFor(req, account)`, `feedbackPageFor(req, page)` | v1 data shaped for the version the request used: unchanged for v1, dates as ISO text for legacy. `{ error }` replies pass straight through. |
| `toUnversionedUrl(url)` | Removes a leading `/api/v1`, for example from URLs in a VM reply. |
| `urlFor(req, url)` | Puts a backend URL (for example `/jobs/<id>/images/0000.jpg`) under the request's version: `/api/v1` is added for v1, nothing for legacy. URLs that are already versioned, absolute, or `null` are left alone. |
| `markLegacy(req, res, next)` | Middleware for the legacy mount only. The reply itself is unchanged, but for paths that do not start with `/api/` it sets **`Deprecation: @<seconds>`** (RFC 9745) and **`Link: </api/v1/…>; rel="successor-version"`**. A versioned path that matched no v1 route also passes through here on its way to the 404, and it is not treated as legacy. |
