/*!************************************************************************
\file RunsTable.jsx
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Sortable, paginated table of every run. Columns come from COLUMNS in
lib/metrics.js so the table and the CSV export always agree. Clicking a
row (or Enter on it) opens that run's detail drawer.
**************************************************************************/

import { useMemo, useState } from 'react'
import { COLUMNS } from '../lib/metrics.js'

const PAGE_SIZE = 25

function compare(a, b) {
  if (a == null && b == null) return 0
  if (a == null) return 1 // blanks last in either direction
  if (b == null) return -1
  return typeof a === 'number' ? a - b : String(a).localeCompare(String(b))
}

export default function RunsTable({ records, selectedId, onSelect }) {
  const [sort, setSort] = useState({ key: 'finishedAt', dir: -1 })
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key)
    return [...records].sort((ra, rb) => {
      const va = col.get(ra)
      const vb = col.get(rb)
      if (va == null || vb == null) return compare(va, vb)
      return compare(va, vb) * sort.dir
    })
  }, [records, sort])

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const rows = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  function toggle(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: COLUMNS.find((c) => c.key === key).num ? -1 : 1 }))
    setPage(0)
  }

  return (
    <div className="table-wrap">
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className={c.num ? 'num' : undefined}
                  aria-sort={sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => toggle(c.key)}>
                    {c.label}
                    <span className="sort-ind" aria-hidden="true">{sort.key === c.key ? (sort.dir > 0 ? '▲' : '▼') : ''}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.jobId} tabIndex={0} aria-selected={r.jobId === selectedId}
                onClick={() => onSelect(r.jobId)}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(r.jobId)}>
                {COLUMNS.map((c) => (
                  <td key={c.key} className={[c.num && 'num', c.mono && 'mono'].filter(Boolean).join(' ') || undefined}>
                    {c.fmt(c.get(r))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>
          {sorted.length ? `${current * PAGE_SIZE + 1}–${current * PAGE_SIZE + rows.length} of ${sorted.length}` : 'No runs'}
        </span>
        {pages > 1 && (
          <span className="pager">
            <button type="button" className="btn btn-ghost" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
            <span>Page {current + 1} / {pages}</span>
            <button type="button" className="btn btn-ghost" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
          </span>
        )}
      </div>
    </div>
  )
}
