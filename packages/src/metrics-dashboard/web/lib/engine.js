/*!************************************************************************
\file engine.js
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-11-2026
\brief
Data layer for the Engine tab: the desktop engine's metrics recordings
(Record Metrics, Ctrl+Shift+R), written by engine/src/metrics/FrameMetrics.cpp
as <id>.csv (every frame) + <id>.json (summary and one entry per second).
- fetchEngineRecordings(signal)
{ generatedAt, dir, count, recordings[] } summaries, newest first.
- fetchEngineRecording(id, signal)
One recording with its per-second series.
- engineCsvUrl(id)
Download link for a recording's per-frame CSV.
- fmtClock(sec)
Seconds as m:ss for the chart axes.
**************************************************************************/

async function getJson(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }
  return res.json()
}

export const fetchEngineRecordings = (signal) => getJson('/api/engine-recordings', signal)

export const fetchEngineRecording = (id, signal) =>
  getJson(`/api/engine-recordings/${encodeURIComponent(id)}`, signal)

export const engineCsvUrl = (id) => `/api/engine-recordings/${encodeURIComponent(id)}/csv`

export function fmtClock(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return '—'
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Share of counted frames that were drops, in percent.
export function dropPct(rec) {
  return rec?.frames ? (rec.drops / rec.frames) * 100 : null
}
