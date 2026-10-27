/*!************************************************************************
\file HardwareView.jsx
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Hardware tab: compares the machines (host + GPU) runs were recorded on --
training throughput, median times, peak VRAM -- with each machine's spec.
**************************************************************************/

import { Card } from '../components/Kpi.jsx'
import { BarList } from '../components/charts.jsx'
import { groupByMachine } from '../lib/metrics.js'
import { DASH, fmtBytes, fmtDuration, fmtInt, fmtNum } from '../lib/format.js'

export default function HardwareView({ records }) {
  const groups = groupByMachine(records)

  return (
    <div className="stack">
      <Card title="Training throughput by machine" subtitle="Average Brush iterations per second. Higher is faster.">
        <BarList ariaLabel="Iterations per second by machine"
          items={groups.map((g) => ({ key: g.key, label: g.key, value: g.meanItersPerSec }))}
          format={(v) => (v == null ? DASH : `${fmtNum(v)} it/s`)} />
      </Card>

      <div className="machine-grid">
        {groups.map((g) => {
          const hw = g.hardware ?? {}
          return (
            <Card key={g.key} title={g.gpu} subtitle={g.host}>
              <dl className="fields">
                <div><dt>Runs</dt><dd>{fmtInt(g.count)}</dd></div>
                <div><dt>Median total</dt><dd>{fmtDuration(g.medianTotalSec)}</dd></div>
                <div><dt>Median training</dt><dd>{fmtDuration(g.medianTrainingSec)}</dd></div>
                <div><dt>Peak VRAM</dt><dd>{g.peakVramMB ? `${fmtInt(g.peakVramMB)} MB` : DASH}</dd></div>
                <div><dt>CPU</dt><dd>{hw.cpu?.model ?? DASH}{hw.cpu?.logicalCores ? ` · ${hw.cpu.logicalCores} threads` : ''}</dd></div>
                <div><dt>Memory</dt><dd>{hw.memory?.totalMB ? fmtBytes(hw.memory.totalMB * 2 ** 20) : DASH}</dd></div>
                <div><dt>OS</dt><dd>{hw.os ? `${hw.os.platform} ${hw.os.release}` : DASH}</dd></div>
                <div><dt>COLMAP</dt><dd>{hw.tools?.colmap ?? DASH}</dd></div>
              </dl>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
