/*!************************************************************************
\file RunDetail.jsx
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Side drawer with everything recorded for one run: timing and its phase
breakdown, training, input, output, GPU load, hardware, and the raw
metrics.json (viewable and downloadable). Closes on Escape or the scrim.
**************************************************************************/

import { useEffect, useRef, useState } from 'react'
import { downloadFile, orderedPhases } from '../lib/metrics.js'
import { DASH, fmtBytes, fmtDate, fmtDuration, fmtInt, fmtNum } from '../lib/format.js'

function Fields({ rows }) {
  return (
    <dl className="fields">
      {rows.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v ?? DASH}</dd></div>
      ))}
    </dl>
  )
}

export default function RunDetail({ record, onClose }) {
  const [raw, setRaw] = useState(false)
  const closeBtn = useRef(null)

  useEffect(() => {
    closeBtn.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const t = record.timing ?? {}
  const tr = record.training ?? {}
  const inp = record.input ?? {}
  const out = record.output ?? {}
  const gpu = record.gpuDuringTraining
  const hw = record.hardware ?? {}
  const phases = orderedPhases(record)
  const phaseTotal = phases.reduce((a, p) => a + p.sec, 0) || 1

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <p className="eyebrow">Run</p>
            <h2 id="drawer-title" className="mono">{record.jobId}</h2>
            <p className="muted">{fmtDate(record.finishedAt)} · {record.source ?? 'upload'}</p>
          </div>
          <button ref={closeBtn} type="button" className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="drawer-body">
          <section>
            <h3>Timing</h3>
            <Fields rows={[
              ['Pipeline total', fmtDuration(t.totalSec)],
              ['Since job created', fmtDuration(t.sinceCreatedSec)],
              ['COLMAP', fmtDuration(t.colmapSec)],
              ['Training', fmtDuration(t.trainingSec)],
            ]} />
            {phases.length > 0 && (
              <ul className="phase-list">
                {phases.map((p) => (
                  <li key={p.key}>
                    <span className="swatch" style={{ background: p.color }} />
                    <span className="phase-name">{p.label}</span>
                    <span className="phase-track"><span style={{ width: `${(p.sec / phaseTotal) * 100}%`, background: p.color }} /></span>
                    <span className="phase-val">{fmtDuration(p.sec)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>Training</h3>
            <Fields rows={[
              ['Target iterations', fmtInt(tr.iterationsTarget)],
              ['Last iteration logged', fmtInt(tr.lastIterationLogged)],
              ['Iterations / sec', fmtNum(tr.itersPerSec)],
              ['Max resolution', tr.maxResolution ? `${tr.maxResolution}px` : null],
            ]} />
          </section>

          <section>
            <h3>Input &amp; output</h3>
            <Fields rows={[
              ['Images', fmtInt(inp.imageCount)],
              ['Sparse models', fmtInt(inp.sparseModels)],
              ...(inp.youtube ? [['YouTube fps / max frames', `${inp.youtube.fps ?? DASH} / ${inp.youtube.maxFrames ?? DASH}`]] : []),
              ['Splats', fmtInt(out.splatCount)],
              ['Properties / splat', fmtInt(out.propertiesPerSplat)],
              ['PLY format', out.plyFormat],
              ['Raw size', fmtBytes(out.rawPlyBytes)],
              ['Final size', fmtBytes(out.finalPlyBytes)],
              ['Normalized', out.normalized ? 'Yes' : 'No'],
              ['Final PLY', out.finalPly && <span className="mono small">{out.finalPly}</span>],
            ]} />
          </section>

          <section>
            <h3>GPU during training</h3>
            {gpu ? (
              <Fields rows={[
                ['Peak VRAM used', `${fmtInt(gpu.peakVramUsedMB)} MB`],
                ['Average utilisation', `${fmtInt(gpu.avgUtilizationPct)}%`],
                ['Samples', fmtInt(gpu.samples)],
              ]} />
            ) : <p className="muted">Not sampled (needs an NVIDIA driver with nvidia-smi).</p>}
          </section>

          <section>
            <h3>Hardware</h3>
            <Fields rows={[
              ['Host', hw.host],
              ['OS', hw.os && `${hw.os.platform} ${hw.os.release} (${hw.os.arch})`],
              ['CPU', hw.cpu && `${hw.cpu.model ?? DASH} · ${hw.cpu.logicalCores} threads`],
              ['Memory', hw.memory?.totalMB && fmtBytes(hw.memory.totalMB * 2 ** 20)],
              ...(hw.gpus ?? []).map((g, i) => [`GPU ${i + 1}`, `${g.name}${g.vramMB ? ` · ${fmtBytes(g.vramMB * 2 ** 20)}` : ''}`]),
              ['COLMAP', hw.tools?.colmap && `${hw.tools.colmap}${hw.tools.colmapUseGpu ? ' · GPU' : ' · CPU'}`],
              ['Brush', hw.tools?.brush],
              ['Node', hw.node],
            ]} />
          </section>

          <section>
            <div className="section-head">
              <h3>Raw record</h3>
              <span className="btn-row">
                <button type="button" className="btn btn-ghost" onClick={() => setRaw((v) => !v)}>{raw ? 'Hide' : 'Show'} JSON</button>
                <button type="button" className="btn btn-ghost"
                  onClick={() => downloadFile(`metrics-${record.jobId}.json`, JSON.stringify(record, null, 2), 'application/json')}>
                  Download
                </button>
              </span>
            </div>
            {raw && <pre className="code">{JSON.stringify(record, null, 2)}</pre>}
          </section>
        </div>
      </aside>
    </div>
  )
}
