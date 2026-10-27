/*!************************************************************************
\file MetricsView.jsx
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Metrics tab: every metrics.json record in one filterable, sortable table,
with summary figures for the current filter and CSV / JSON export.
Filters: free-text search (job id, host, GPU), source and machine.
**************************************************************************/

import { useMemo, useState } from 'react'
import { Card, Kpi } from '../components/Kpi.jsx'
import RunsTable from '../components/RunsTable.jsx'
import { downloadFile, machineKey, summarize, toCsv } from '../lib/metrics.js'
import { fmtDuration, fmtInt, fmtNum } from '../lib/format.js'

export default function MetricsView({ records, selectedId, onSelect }) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [machine, setMachine] = useState('all')

  const sources = useMemo(() => [...new Set(records.map((r) => r.source ?? 'upload'))].sort(), [records])
  const machines = useMemo(() => [...new Set(records.map(machineKey))].sort(), [records])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return records.filter((r) => {
      if (source !== 'all' && (r.source ?? 'upload') !== source) return false
      if (machine !== 'all' && machineKey(r) !== machine) return false
      if (!q) return true
      return [r.jobId, r.hardware?.host, ...(r.hardware?.gpus ?? []).map((g) => g.name)]
        .some((v) => v?.toLowerCase().includes(q))
    })
  }, [records, query, source, machine])

  const s = summarize(filtered)
  const filteredOn = query || source !== 'all' || machine !== 'all'
  const stamp = new Date().toISOString().slice(0, 10)

  return (
    <div className="stack">
      <div className="toolbar" role="search">
        <input type="search" className="input" placeholder="Search job id, host or GPU…" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="Search runs" />
        <select className="input" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="all">All sources</option>
          {sources.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select className="input" value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Machine">
          <option value="all">All machines</option>
          {machines.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        {filteredOn && (
          <button type="button" className="btn btn-ghost" onClick={() => { setQuery(''); setSource('all'); setMachine('all') }}>
            Clear
          </button>
        )}
        <span className="toolbar-spacer" />
        <button type="button" className="btn" disabled={!filtered.length}
          onClick={() => downloadFile(`metrics-${stamp}.csv`, toCsv(filtered), 'text/csv')}>
          Export CSV
        </button>
        <button type="button" className="btn" disabled={!filtered.length}
          onClick={() => downloadFile(`metrics-${stamp}.json`, JSON.stringify(filtered, null, 2), 'application/json')}>
          Export JSON
        </button>
      </div>

      <div className="kpi-grid kpi-grid-compact">
        <Kpi label="Runs" value={`${fmtInt(filtered.length)}${filteredOn ? ` / ${fmtInt(records.length)}` : ''}`} />
        <Kpi label="Median total" value={fmtDuration(s.medianTotalSec)} />
        <Kpi label="Median COLMAP" value={fmtDuration(s.medianColmapSec)} />
        <Kpi label="Median training" value={fmtDuration(s.medianTrainingSec)} />
        <Kpi label="Avg iter/s" value={fmtNum(s.meanItersPerSec)} />
      </div>

      <Card title="All runs" subtitle="One row per metrics.json. Click a row for the full record.">
        <RunsTable records={filtered} selectedId={selectedId} onSelect={onSelect} />
      </Card>
    </div>
  )
}
