/*!************************************************************************
\file ratelimit.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 21-10-2026
\brief
A small in-memory, fixed-window rate limiter used to slow down password
guessing and signup spam. Counters live in this process only, so they reset
when the server restarts -- fine for this purpose, and no extra package or
database table is needed.
- createLimiter({ windowMs, max })
Returns a limiter. hit(key) counts one event for key (an IP address or an
email) and says whether it is still allowed; check(key) asks without
counting; reset(key) clears the key (e.g. after a successful login).
**************************************************************************/

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Makes a limiter that allows at most max events per key within each
    window of windowMs. A key's window starts at its first event.
  \param options
    { windowMs, max }
  \return
    { hit(key), check(key), reset(key) }. hit and check return
    { allowed, retryAfterSec }.
*/
/************************************************************************/
export function createLimiter({ windowMs, max })
{
  const entries = new Map() // key -> { count, resetAt }

  // Drop finished windows now and then so the map can't grow forever.
  const sweep = setInterval(() =>
  {
    const now = Date.now()
    for (const [key, entry] of entries)
    {
      if (entry.resetAt <= now) entries.delete(key)
    }
  }, windowMs)
  sweep.unref() // never keeps the process alive on its own

  function current(key)
  {
    const entry = entries.get(key)
    if (entry && entry.resetAt > Date.now()) return entry
    entries.delete(key)
    return null
  }

  function result(entry)
  {
    if (!entry || entry.count < max) return { allowed: true, retryAfterSec: 0 }
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - Date.now()) / 1000) }
  }

  return {
    // Counts one event, then reports whether the key is still under the limit.
    hit(key)
    {
      let entry = current(key)
      if (!entry)
      {
        entry = { count: 0, resetAt: Date.now() + windowMs }
        entries.set(key, entry)
      }
      entry.count++
      return entry.count > max
        ? { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - Date.now()) / 1000) }
        : { allowed: true, retryAfterSec: 0 }
    },
    // Reports whether the key is already at the limit, without counting.
    check(key)
    {
      return result(current(key))
    },
    reset(key)
    {
      entries.delete(key)
    },
  }
}

// ----- End of Functions ----------------------------------------------------- //
