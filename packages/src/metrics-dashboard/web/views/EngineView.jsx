/*!************************************************************************
\file EngineView.jsx
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-11-2026
\brief
Engine tab: the desktop engine's metrics recordings (Record Metrics,
Ctrl+Shift+R in the editor). Shows the selected recording's headline
numbers (average frame rate, 1% low, drops, frame time, splats), its frame
rate / drops / splat count per second, a list of every recording, and the
average frame rate of recent recordings side by side. Linkable as
#/engine/<recording id>; loads independently of the pipeline metrics.
**************************************************************************/

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, EmptyState, Kpi } from '../components/Kpi.jsx'
import { BarList, TimeSeriesChart } from '../components/charts.jsx'
import { dropPct, engineCsvUrl, fetchEngineRecording, fetchEngineRecordings, fmtClock } from '../lib/engine.js'
import { DASH, fmtDate, fmtDuration, fmtInt, fmtNum, fmtRelative } from '../lib/format.js'

const REFRESH_MS = 30_000
const COMPARE = 12
// Recordings table: [label, numeric]. Header cells get the padding the sortable tables' buttons give them.
const COLUMNS = [['Started', false], ['Duration', true], ['Avg FPS', true], ['1% low', true], ['p95 ms', true],
  ['Drops', true], ['Max splats', true], ['GPU', false]]
const TH_PAD = { paddingTop: 9, paddingBottom: 9 }

function idFromHash() {
  const [, id] = window.location.hash.replace(/^#\/?/, '').split('/')
  return id || null
}

const fps = (v) => `${fmtNum(v, 0)}`
const ms = (v) => `${fmtNum(v, 1)} ms`

export default function EngineView({ refreshKey, autoRefresh }) {
  const [list, setList] = useState({ data: null, error: null, loading: true })
  const [selectedId, setSelectedId] = useState(idFromHash)
  const [detail, setDetail] = useState({ id: null, rec: null, error: null })
  const listCtl = useRef(null)

  const loadList = useCallback(() => {
    listCtl.current?.abort()
    const ctl = new AbortController()
    listCtl.current = ctl
    setList((s) => ({ ...s, loading: true }))
    fetchEngineRecordings(ctl.signal)
      .then((data) => setList({ data, error: null, loading: false }))
      .catch((err) => {
        if (err.name !== 'AbortError') setList((s) => ({ ...s, error: err.message, loading: false }))
      })
  }, [])

  // Initial load and the header's Refresh button (refreshKey changes).
  useEffect(() => {
    const first = setTimeout(loadList, 0)
    return () => {
      clearTimeout(first)
      listCtl.current?.abort()
    }
  }, [loadList, refreshKey])

  useEffect(() => {
    if (!autoRefresh) return undefined
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') loadList()
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [loadList, autoRefresh])

  const recordings = list.data?.recordings ?? []
  // The linked / clicked recording if it exists, otherwise the newest.
  const activeId = recordings.some((r) => r.id === selectedId) ? selectedId : recordings[0]?.id ?? null

  useEffect(() => {
    if (!activeId) return undefined
    const ctl = new AbortController()
    fetchEngineRecording(activeId, ctl.signal)
      .then((rec) => setDetail({ id: activeId, rec, error: null }))
      .catch((err) => {
        if (err.name !== 'AbortError') setDetail({ id: activeId, rec: null, error: err.message })
      })
    return () => ctl.abort()
  }, [activeId, refreshKey])

  function select(id) {
    setSelectedId(id)
    window.history.replaceState(null, '', `#/engine/${id}`)
  }

  if (!list.data && list.loading) return <div className="skeleton" aria-busy="true">Loading engine recordings…</div>
  if (!list.data && list.error) {
    return (
      <EmptyState title="Can't reach the metrics server">
        <p>{list.error}</p>
        <button type="button" className="btn" onClick={loadList}>Retry</button>
      </EmptyState>
    )
  }
  if (!recordings.length) {
    return (
      <EmptyState title="No engine recordings yet">
        <p>
          In the desktop engine, press <b>Record Metrics</b> on the toolbar (or <code>Ctrl+Shift+R</code>), use the
          sandbox, then press it again to stop. The recording appears here.
        </p>
        <p className="small">Reading <code>{list.data?.dir}</code>. Set <code>ENGINE_METRICS_DIR</code> to read another folder.</p>
      </EmptyState>
    )
  }

  const rec = detail.id === activeId ? detail.rec : null
  const summary = recordings.find((r) => r.id === activeId)
  const r = rec ?? summary
  const seconds = rec?.seconds ?? []
  const pct = dropPct(r)

  return (
    <div className="stack">
      <Card
        title={`Recording ${fmtDate(r.startedAt)}`}
        subtitle={`${r.host ?? DASH} · ${r.gpu || 'GPU unknown'} · ${fmtNum(r.refreshHz, 0)} Hz display · ${fmtRelative(r.startedAt)}`}
        actions={<a className="btn" style={{ textDecoration: 'none', color: 'inherit' }} href={engineCsvUrl(r.id)} download>Download CSV</a>}
      >
        <div className="kpi-grid">
          <Kpi label="Average frame rate" value={`${fmtNum(r.avgFps, 1)} FPS`} hint={`${fmtInt(r.frames)} frames over ${fmtDuration(r.durationSec)}`} />
          <Kpi label="1% low" value={`${fmtNum(r.onePercentLowFps, 1)} FPS`} hint={`Slowest second ${fmtNum(r.minSecondFps, 1)} FPS`} />
          <Kpi label="Frame drops" value={fmtInt(r.drops)}
            hint={pct == null ? DASH : `${fmtNum(pct, 1)}% of frames · ${fmtInt(r.missedVsyncs)} missed refreshes`} />
          <Kpi label="Frame time p95" value={ms(r.p95FrameMs)} hint={`avg ${ms(r.avgFrameMs)} · max ${ms(r.maxFrameMs)}`} />
          <Kpi label="Splats" value={fmtInt(r.splats?.max)}
            hint={r.splats?.min === r.splats?.max ? `${fmtInt(r.maxModels)} model(s)` : `${fmtInt(r.splats?.min)} – ${fmtInt(r.splats?.max)} · up to ${fmtInt(r.maxModels)} models`} />
          <Kpi label="Scene draw" value={r.avgGpuSceneMs == null ? DASH : `${fmtNum(r.avgGpuSceneMs, 2)} ms`}
            hint={`GPU avg · CPU ${fmtNum(r.avgCpuSceneMs, 2)} ms`} />
        </div>
        {r.pauses > 0 && (
          <p className="muted small" style={{ marginTop: 12 }}>
            {fmtInt(r.pauses)} frame(s) over a second (window hidden or minimised) were left out of the averages.
          </p>
        )}
      </Card>

      {detail.id === activeId && detail.error && (
        <EmptyState title="Couldn't load this recording's timeline"><p>{detail.error}</p></EmptyState>
      )}

      {seconds.length > 0 && (
        <>
          <Card title="Frame rate" subtitle="Average FPS in each second of the recording. Dashed line: the display's refresh rate (the most vsync allows).">
            <TimeSeriesChart
              points={seconds.map((s) => ({ ...s, x: s.t, y: s.fps }))}
              yFormat={fps} refY={r.refreshHz} refLabel={`${fmtNum(r.refreshHz, 0)} Hz`}
              ariaLabel="Frames per second over the recording"
              renderTooltip={(p) => (
                <>
                  <div className="tooltip-title">{fmtClock(p.t)}</div>
                  <div className="tooltip-row"><span>FPS</span><b>{fmtNum(p.fps, 1)}</b></div>
                  <div className="tooltip-row"><span>Frames</span><b>{fmtInt(p.frames)}</b></div>
                  <div className="tooltip-row"><span>Slowest frame</span><b>{p.maxFrameMs == null ? DASH : ms(p.maxFrameMs)}</b></div>
                </>
              )}
            />
          </Card>

          <Card title="Frame drops" subtitle="Frames that missed at least one display refresh, per second.">
            <TimeSeriesChart
              points={seconds.map((s) => ({ ...s, x: s.t, y: s.drops }))}
              bars color="var(--series-2)" yFormat={(v) => fmtInt(v)} height={160}
              ariaLabel="Frame drops per second"
              renderTooltip={(p) => (
                <>
                  <div className="tooltip-title">{fmtClock(p.t)}</div>
                  <div className="tooltip-row"><span>Drops</span><b>{fmtInt(p.drops)}</b></div>
                  <div className="tooltip-row"><span>of frames</span><b>{fmtInt(p.frames)}</b></div>
                </>
              )}
            />
          </Card>

          <Card title="Splat count" subtitle="Splats in the scene each second, to line up slowdowns with models being added.">
            <TimeSeriesChart
              points={seconds.map((s) => ({ ...s, x: s.t, y: s.splats }))}
              color="var(--series-3)" yFormat={(v) => fmtInt(v)} height={160}
              ariaLabel="Splat count over the recording"
              renderTooltip={(p) => (
                <>
                  <div className="tooltip-title">{fmtClock(p.t)}</div>
                  <div className="tooltip-row"><span>Splats</span><b>{fmtInt(p.splats)}</b></div>
                  <div className="tooltip-row"><span>Models</span><b>{fmtInt(p.models)}</b></div>
                </>
              )}
            />
          </Card>
        </>
      )}

      <Card title="Recordings" subtitle="Every recording on this machine, newest first. Click one to view it.">
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {COLUMNS.map(([label, num]) => (
                    <th key={label} className={num ? 'num' : undefined} style={TH_PAD}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recordings.map((x) => (
                  <tr key={x.id} tabIndex={0} aria-selected={x.id === activeId}
                    onClick={() => select(x.id)} onKeyDown={(e) => e.key === 'Enter' && select(x.id)}>
                    <td>{fmtDate(x.startedAt)}</td>
                    <td className="num">{fmtDuration(x.durationSec)}</td>
                    <td className="num">{fmtNum(x.avgFps, 1)}</td>
                    <td className="num">{fmtNum(x.onePercentLowFps, 1)}</td>
                    <td className="num">{fmtNum(x.p95FrameMs, 2)}</td>
                    <td className="num">{fmtInt(x.drops)}</td>
                    <td className="num">{fmtInt(x.splats?.max)}</td>
                    <td>{x.gpu || DASH}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer"><span>{recordings.length} recording{recordings.length === 1 ? '' : 's'}</span></div>
        </div>
      </Card>

      {recordings.length > 1 && (
        <Card title="Average frame rate by recording" subtitle={`The ${Math.min(COMPARE, recordings.length)} most recent recordings.`}>
          <BarList
            ariaLabel="Average frame rate per recording"
            items={recordings.slice(0, COMPARE).map((x) => ({
              key: x.id,
              label: `${fmtDate(x.startedAt)} · ${fmtInt(x.splats?.max)} splats`,
              value: x.avgFps,
            }))}
            format={(v) => `${fmtNum(v, 1)} FPS`}
          />
        </Card>
      )}
    </div>
  )
}
