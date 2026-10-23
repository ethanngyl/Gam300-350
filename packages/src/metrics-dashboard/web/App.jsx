/*!************************************************************************
\file App.jsx
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Shell of the Pipeline Metrics dashboard: header with refresh controls and
theme toggle, tab bar (Overview / Metrics / Hardware, routed through the
URL hash), loading / error / empty states, and the run detail drawer.
**************************************************************************/

import { useCallback, useEffect, useState } from 'react'
import RunDetail from './components/RunDetail.jsx'
import { EmptyState } from './components/Kpi.jsx'
import OverviewView from './views/OverviewView.jsx'
import MetricsView from './views/MetricsView.jsx'
import HardwareView from './views/HardwareView.jsx'
import { useHashRoute, useMetrics } from './lib/hooks.js'
import { fmtRelative } from './lib/format.js'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'hardware', label: 'Hardware' },
]
const TAB_KEYS = TABS.map((t) => t.key)
const REFRESH_MS = 30_000
const THEME_KEY = 'metrics-dashboard-theme'

function loadTheme() {
  try {
    return window.localStorage.getItem(THEME_KEY) ?? 'system'
  } catch {
    return 'system'
  }
}

export default function App() {
  const [tab, setTab] = useHashRoute(TAB_KEYS, 'overview')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [theme, setTheme] = useState(loadTheme)
  const { data, error, loading, refresh } = useMetrics(autoRefresh ? REFRESH_MS : 0)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      window.localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Storage blocked: the choice just won't persist.
    }
  }, [theme])

  const closeDetail = useCallback(() => setSelectedId(null), [])
  const records = data?.records ?? []
  const selected = records.find((r) => r.jobId === selectedId)

  let body
  if (!data && loading) body = <div className="skeleton" aria-busy="true">Loading metrics…</div>
  else if (!data && error) {
    body = (
      <EmptyState title="Can't reach the metrics server">
        <p>{error}</p>
        <p>Start it with <code>npm run metrics:start</code> (or <code>metrics:dev</code>) from <code>packages/</code>.</p>
        <button type="button" className="btn" onClick={refresh}>Retry</button>
      </EmptyState>
    )
  } else if (!records.length) {
    body = (
      <EmptyState title="No metrics yet">
        <p>Each finished reconstruction writes <code>jobs/&lt;id&gt;_out/metrics.json</code>. Run a job in the main app and it will appear here.</p>
      </EmptyState>
    )
  } else if (tab === 'metrics') body = <MetricsView records={records} selectedId={selectedId} onSelect={setSelectedId} />
  else if (tab === 'hardware') body = <HardwareView records={records} />
  else body = <OverviewView records={records} onSelect={setSelectedId} />

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Pipeline Metrics</h1>
            <p className="muted">Gaussian splat generation · COLMAP + Brush</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`status-pill ${error ? 'is-error' : ''}`} role="status">
            <span className="dot" aria-hidden="true" />
            {error ? 'Offline' : data ? `Updated ${fmtRelative(data.generatedAt)}` : 'Connecting'}
          </span>
          <label className="switch">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh
          </label>
          <button type="button" className="btn" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <select className="input input-sm" value={theme} onChange={(e) => setTheme(e.target.value)} aria-label="Theme">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Dashboard sections">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={`tab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'metrics' && records.length > 0 && <span className="tab-count">{records.length}</span>}
          </button>
        ))}
      </nav>

      <main className="content" role="tabpanel">{body}</main>

      {selected && <RunDetail record={selected} onClose={closeDetail} />}
    </div>
  )
}
