/*!************************************************************************
\file scale.js
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Minimal scale helpers for the hand-drawn SVG charts (no chart library).
- niceTicks(max, count)
Zero-based "nice" tick values (1, 2, 2.5, 5 x 10^n steps) covering max.
- durationTicks(maxSec, count)
niceTicks for a seconds axis, in whole minutes past two minutes.
- linear(domain, range)
Maps a value from domain to range.
**************************************************************************/

export function niceTicks(max, count = 4, multiples = [1, 2, 2.5, 5, 10]) {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = multiples.map((m) => m * pow).find((s) => s >= raw)
  const ticks = []
  for (let v = 0; v < max + step * 0.5; v += step) ticks.push(Number(v.toPrecision(12)))
  if (ticks.at(-1) < max) ticks.push(ticks.at(-1) + step)
  return ticks
}

// Seconds axis: whole-minute steps (1, 2, 5, 10 min...) once past two
// minutes, so ticks read 5m 00s rather than 3m 20s.
export function durationTicks(maxSec, count = 4) {
  if (maxSec <= 120) return niceTicks(maxSec, count)
  return niceTicks(maxSec / 60, count, [1, 2, 5, 10]).map((m) => m * 60)
}

export function linear([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1
  return (v) => r0 + ((v - d0) / span) * (r1 - r0)
}
