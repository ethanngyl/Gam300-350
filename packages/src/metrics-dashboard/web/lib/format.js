/*!************************************************************************
\file format.js
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Display formatters for the metrics dashboard. Every one accepts null /
undefined (fields a record may lack) and returns an em dash for them.
- fmtDuration(sec) / fmtBytes(bytes) / fmtInt(n) / fmtNum(n, digits)
- fmtDate(iso) / fmtRelative(iso) / shortId(id)
**************************************************************************/

export const DASH = '—'

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)

// 42.3s, 3m 05s, 1h 12m
export function fmtDuration(sec) {
  if (!isNum(sec)) return DASH
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function fmtBytes(bytes) {
  if (!isNum(bytes)) return DASH
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function fmtInt(n) {
  return isNum(n) ? Math.round(n).toLocaleString() : DASH
}

export function fmtNum(n, digits = 1) {
  return isNum(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : DASH
}

export function fmtDate(iso) {
  if (!iso) return DASH
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? DASH
    : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtRelative(iso, now = Date.now()) {
  if (!iso) return DASH
  const diff = Math.round((now - new Date(iso).getTime()) / 1000)
  if (!Number.isFinite(diff)) return DASH
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  return `${Math.floor(diff / 86400)} d ago`
}

export const shortId = (id) => (id ? id.slice(0, 8) : DASH)
