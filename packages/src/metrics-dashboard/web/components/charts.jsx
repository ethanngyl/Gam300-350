/*!************************************************************************
\file charts.jsx
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Hand-drawn SVG charts for the metrics dashboard. Each one is responsive
(follows its container's width), has a hover tooltip, and draws text in
text tokens rather than series colours.
- Tooltip
Positioned hover card shared by the charts.
- TrendChart({ points, format, onSelect })
Single-series line over time with markers and a crosshair.
- PhaseBreakdown({ records, onSelect })
One stacked horizontal bar per run, segment per pipeline phase.
- BarList({ items, format })
Single-series horizontal bars with the value labelled at the end.
**************************************************************************/

import { useState } from 'react'
import { useElementWidth } from '../lib/hooks.js'
import { orderedPhases, PHASES } from '../lib/metrics.js'
import { fmtDate, fmtDuration, shortId } from '../lib/format.js'
import { durationTicks, linear, niceTicks } from '../lib/scale.js'

export function Tooltip({ x, y, width, children }) {
  // Flip to the left of the pointer near the right edge.
  const flip = x > width - 200
  return (
    <div className="tooltip" role="status" style={{ left: x, top: y, transform: `translate(${flip ? 'calc(-100% - 12px)' : '12px'}, -50%)` }}>
      {children}
    </div>
  )
}

export function TrendChart({ points, format = fmtDuration, height = 240, onSelect }) {
  const [ref, width] = useElementWidth()
  const [hover, setHover] = useState(null)
  const m = { top: 16, right: 20, bottom: 30, left: 60 }
  const w = Math.max(width - m.left - m.right, 10)
  const h = height - m.top - m.bottom

  const sorted = [...points].sort((a, b) => a.x - b.x)
  const yData = Math.max(...sorted.map((p) => p.y), 0)
  const ticks = format === fmtDuration ? durationTicks(yData) : niceTicks(yData)
  const yMax = ticks.at(-1)
  const xs = sorted.map((p) => p.x)
  const single = sorted.length === 1
  const x = single ? () => w / 2 : linear([Math.min(...xs), Math.max(...xs)], [0, w])
  const y = linear([0, yMax], [h, 0])
  const path = sorted.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('')

  // X labels: first, middle and last run.
  const xLabels = single ? sorted : [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted.at(-1)]

  function onMove(e) {
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left - m.left
    let best = null
    for (const p of sorted) if (!best || Math.abs(x(p.x) - px) < Math.abs(x(best.x) - px)) best = p
    setHover(best)
  }

  return (
    <div ref={ref} className="chart">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Total pipeline time per run"
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}
          onClick={() => hover && onSelect?.(hover.id)} style={{ cursor: onSelect && hover ? 'pointer' : 'default' }}>
          <g transform={`translate(${m.left},${m.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={0} x2={w} y1={y(t)} y2={y(t)} />
                <text className="axis-label" x={-10} y={y(t)} dy="0.32em" textAnchor="end">{format(t)}</text>
              </g>
            ))}
            {xLabels.map((p, i) => (
              <text key={p.id} className="axis-label" x={x(p.x)} y={h + 20}
                textAnchor={single ? 'middle' : i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}>
                {new Date(p.x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </text>
            ))}
            {hover && <line className="crosshair" x1={x(hover.x)} x2={x(hover.x)} y1={0} y2={h} />}
            {!single && <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />}
            {sorted.map((p) => (
              <circle key={p.id} cx={x(p.x)} cy={y(p.y)} r={hover?.id === p.id ? 5.5 : 4}
                fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
            ))}
          </g>
        </svg>
      )}
      {hover && (
        <Tooltip x={m.left + x(hover.x)} y={m.top + y(hover.y)} width={width}>
          <div className="tooltip-title">{fmtDate(new Date(hover.x).toISOString())}</div>
          <div className="tooltip-row"><span>Job</span><b className="mono">{shortId(hover.id)}</b></div>
          <div className="tooltip-row"><span>Total</span><b>{format(hover.y)}</b></div>
        </Tooltip>
      )}
    </div>
  )
}

export function PhaseLegend({ keys }) {
  return (
    <ul className="legend" aria-label="Pipeline phases">
      {PHASES.filter((p) => keys.has(p.key)).map((p) => (
        <li key={p.key}><span className="swatch" style={{ background: p.color }} />{p.label}</li>
      ))}
      {keys.has('other') && <li><span className="swatch" style={{ background: 'var(--series-other)' }} />Other</li>}
    </ul>
  )
}

export function PhaseBreakdown({ records, onSelect }) {
  const [ref, width] = useElementWidth()
  const [hover, setHover] = useState(null)
  const rowH = 20
  const gapY = 10
  const labelW = 84
  const valueW = 68
  const w = Math.max(width - labelW - valueW, 10)

  const rows = records.map((r) => ({ r, phases: orderedPhases(r) }))
  const totals = rows.map(({ phases }) => phases.reduce((a, p) => a + p.sec, 0))
  const max = Math.max(...totals, 1)
  const x = linear([0, max], [0, w])
  const used = new Set(rows.flatMap(({ phases }) => phases.map((p) => p.key)))
  const height = rows.length * (rowH + gapY)

  return (
    <div ref={ref} className="chart">
      <PhaseLegend keys={used} />
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Time spent per pipeline phase, per run"
          onMouseLeave={() => setHover(null)}>
          {rows.map(({ r, phases }, i) => {
            const top = i * (rowH + gapY)
            const barW = x(totals[i])
            let cursor = 0
            return (
              <g key={r.jobId} transform={`translate(0,${top})`} className={onSelect ? 'clickable' : undefined}
                onClick={() => onSelect?.(r.jobId)}>
                <text className="axis-label mono" x={0} y={rowH / 2} dy="0.32em">{shortId(r.jobId)}</text>
                <clipPath id={`bar-${r.jobId}`}>
                  <rect x={labelW} y={0} width={barW} height={rowH} rx={4} />
                </clipPath>
                <g clipPath={`url(#bar-${r.jobId})`}>
                  {phases.map((p) => {
                    const sx = labelW + x(cursor)
                    const sw = x(p.sec)
                    cursor += p.sec
                    return (
                      <rect key={p.key} x={sx} y={0} width={Math.max(sw - 2, 0.5)} height={rowH} fill={p.color}
                        opacity={hover && (hover.id !== r.jobId || hover.phase.key !== p.key) ? 0.45 : 1}
                        onMouseMove={(e) => {
                          const box = e.currentTarget.ownerSVGElement.getBoundingClientRect()
                          setHover({ id: r.jobId, phase: p, total: totals[i], px: e.clientX - box.left, py: top + rowH / 2 })
                        }} />
                    )
                  })}
                </g>
                <text className="value-label" x={labelW + barW + 8} y={rowH / 2} dy="0.32em">{fmtDuration(totals[i])}</text>
              </g>
            )
          })}
        </svg>
      )}
      {hover && (
        <Tooltip x={hover.px} y={hover.py + 36} width={width}>
          <div className="tooltip-title">{hover.phase.label}</div>
          <div className="tooltip-row"><span>Job</span><b className="mono">{shortId(hover.id)}</b></div>
          <div className="tooltip-row"><span>Time</span><b>{fmtDuration(hover.phase.sec)}</b></div>
          <div className="tooltip-row"><span>Share</span><b>{Math.round((hover.phase.sec / hover.total) * 100)}%</b></div>
        </Tooltip>
      )}
    </div>
  )
}

export function BarList({ items, format, ariaLabel }) {
  const max = Math.max(...items.map((i) => i.value ?? 0), 1)
  return (
    <ul className="barlist" aria-label={ariaLabel}>
      {items.map((it) => (
        <li key={it.key} title={`${it.label}: ${format(it.value)}`}>
          <span className="barlist-label">{it.label}</span>
          <span className="barlist-track">
            <span className="barlist-bar" style={{ width: `${((it.value ?? 0) / max) * 100}%` }} />
          </span>
          <span className="barlist-value">{format(it.value)}</span>
        </li>
      ))}
    </ul>
  )
}
