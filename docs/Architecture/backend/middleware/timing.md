# `backend/middleware/timing.js`

*Author: Gabriel.* API layer: times **every API request** from arrival to the last byte sent (or until the browser hangs up), and records it under its route in [services/performance](../services/performance.md). It is mounted **first** in `server.js`, so body parsing is included.

## `NO_ROUTE = '(no route)'`
Every request for a path the API does not have is counted under this one name, so made-up URLs cannot create new names.

## `routeName(req)`
Returns `"<METHOD> <pattern>"` using `req.route.path`, for example `GET /jobs/:id`, or `null` if no route answered. The name is the same for `/api/v1` and the legacy paths. Some routes are registered for both a path and its `/library` version (an array of patterns); the function picks the one that matches whether the URL (with `/api/v1` removed) starts with `/library/`.

## `timeRequests(req, res, next)`
Takes a start time with `process.hrtime.bigint()`. On whichever of `finish` or `close` comes first (recorded once), it works out the name: the route name, else `NO_ROUTE` for a 404, else `null`. A `null` name means one of the website's own static files, which is not recorded. Otherwise it calls `recordTiming('api', name, ms, { error: status >= 500 })`.
