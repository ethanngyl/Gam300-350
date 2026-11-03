/*!************************************************************************
\file apiVersions.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Adapter between the two API versions the backend answers (see
docs/api-changelog.md). The same routes are mounted at /api/v1/... and at
the old unversioned paths ("legacy", kept unchanged for the website, the
engine and older machines). Everything inside the backend uses the v1
shape: dates as UTC epoch milliseconds. Only users, account details and
feedback differ: the legacy API sends their dates as ISO 8601 text.
Replies from the VM may come in either shape (an older VM, or the legacy
paths machines use to talk to each other), so the toV1... functions
accept both.
- isLegacy(req)
Whether the request came in on the legacy (unversioned) paths.
- toMs(value) / toIso(ms)
A date in either form as milliseconds / milliseconds as ISO text.
- toV1User / toV1Account / toV1FeedbackPage
Data from this backend or the VM, in the v1 shape.
- userFor / accountFor / feedbackPageFor(req, data)
v1 data shaped for the version the request asked for.
- urlFor(req, url)
A URL the backend hands out (e.g. a photo's), under the request's version.
**************************************************************************/

export const API_V1_PREFIX = '/api/v1'

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Whether a request used the legacy (unversioned) paths. The routes are
    mounted twice, and req.baseUrl is where the router was mounted.
  \param req
    The request
  \return
    bool
*/
/************************************************************************/
export function isLegacy(req)
{
  return !req.baseUrl.startsWith(API_V1_PREFIX)
}

/************************************************************************/
/*!
  \brief
    A date as UTC epoch milliseconds, whatever form it came in: a number
    (kept), ISO text, or SQLite's "YYYY-MM-DD HH:MM:SS" (UTC, no zone).
  \param value
    number | string | null
  \return
    number, or null if missing or unreadable
*/
/************************************************************************/
export function toMs(value)
{
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value) return null
  const text = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
  const ms = Date.parse(text)
  return Number.isNaN(ms) ? null : ms
}

/************************************************************************/
/*!
  \brief
    Milliseconds as the ISO text the legacy API has always sent: UTC to
    the second, "2026-10-04T08:15:00Z" (the database used to keep whole
    seconds, so legacy clients never saw milliseconds).
  \param ms
    number | null
  \return
    string, or null
*/
/************************************************************************/
export function toIso(ms)
{
  return typeof ms === 'number' ? `${new Date(ms).toISOString().slice(0, 19)}Z` : null
}

/************************************************************************/
/*!
  \brief
    A user ({ name, email, role, createdAt, memberSince }) in the v1 shape.
  \param user
    object from publicUser or a VM reply
  \return
    object (createdAt in ms)
*/
/************************************************************************/
export function toV1User(user)
{
  return user ? { ...user, createdAt: toMs(user.createdAt) } : user
}

/************************************************************************/
/*!
  \brief
    Account details (services/accounts.js accountDetails) in the v1 shape.
  \param account
    object from accountDetails or a VM reply
  \return
    object (createdAt, passwordChangedAt in ms)
*/
/************************************************************************/
export function toV1Account(account)
{
  if (!account?.email) return account
  return { ...account, createdAt: toMs(account.createdAt), passwordChangedAt: toMs(account.passwordChangedAt) }
}

/************************************************************************/
/*!
  \brief
    A page of feedback ({ items, hasMore }) in the v1 shape.
  \param page
    object from listFeedback or a VM reply
  \return
    object (each item's createdAt in ms)
*/
/************************************************************************/
export function toV1FeedbackPage(page)
{
  if (!Array.isArray(page?.items)) return page
  return { ...page, items: page.items.map((item) => ({ ...item, createdAt: toMs(item.createdAt) })) }
}

/************************************************************************/
/*!
  \brief
    v1 data as the request's version expects it: unchanged for v1, dates
    as ISO text for the legacy paths.
  \param req
    The request
  \param data
    v1 user / account / feedback page (or an { error } reply, passed on)
  \return
    object
*/
/************************************************************************/
export function userFor(req, user)
{
  if (!isLegacy(req) || !user?.email) return user
  return { ...user, createdAt: toIso(user.createdAt) }
}

export function accountFor(req, account)
{
  if (!isLegacy(req) || !account?.email) return account
  return { ...account, createdAt: toIso(account.createdAt), passwordChangedAt: toIso(account.passwordChangedAt) }
}

export function feedbackPageFor(req, page)
{
  if (!isLegacy(req) || !Array.isArray(page?.items)) return page
  return { ...page, items: page.items.map((item) => ({ ...item, createdAt: toIso(item.createdAt) })) }
}

/************************************************************************/
/*!
  \brief
    A backend URL (e.g. /jobs/<id>/images/0000.jpg) under the version the
    request used: /api/v1/jobs/... for v1, unchanged for legacy. URLs that
    are already versioned, absolute or null are left alone.
  \param req
    The request
  \param url
    string | null
  \return
    string | null
*/
/************************************************************************/
export function urlFor(req, url)
{
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('/api/')) return url
  return isLegacy(req) ? url : `${API_V1_PREFIX}${url}`
}
// ----- End of Functions ----------------------------------------------------- //
