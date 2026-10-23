/*!************************************************************************
\file OverviewView.jsx
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Overview tab: headline KPIs, total pipeline time over time, and the phase
breakdown of the most recent runs.
**************************************************************************/

import { Card, Kpi } from '../components/Kpi.jsx'
import { PhaseBreakdown, TrendChart } from '../components/charts.jsx'
import { summarize } from '../lib/metrics.js'
import { fmtBytes, fmtDuration, fmtInt, fmtNum, fmtRelative } from '../lib/format.js'

const RECENT = 10

export default function OverviewView({ records, onSelect }) {
  const s = summarize(records)
  const points = records
    .filter((r) => typeof r.timing?.totalSec === 'number')
    .map((r) => ({ id: r.jobId, x: new Date(r.finishedAt).getTime(), y: r.timing.totalSec }))

  return (
    <div className="stack">
      <div className="kpi-grid">
        <Kpi label="Runs recorded" value={fmtInt(s.runs)} hint={`Last ${fmtRelative(s.lastRunAt)}`} />
        <Kpi label="Median total time" value={fmtDuration(s.medianTotalSec)} hint="Pipeline start → .ply ready" />
        <Kpi label="Median training" value={fmtDuration(s.medianTrainingSec)} hint={`COLMAP ${fmtDuration(s.medianColmapSec)}`} />
        <Kpi label="Avg iterations / sec" value={fmtNum(s.meanItersPerSec)} hint="Brush training throughput" />
        <Kpi label="Median splats" value={fmtInt(s.medianSplats)} hint={`${fmtBytes(s.totalBytes)} generated`} />
        <Kpi label="Machines" value={fmtInt(s.machines)} hint="Distinct host + GPU" />
      </div>

      <Card title="Total pipeline time" subtitle="Per run, pipeline start to finished .ply. Click a point for details.">
        <TrendChart points={points} onSelect={onSelect} />
      </Card>

      <Card title="Phase breakdown" subtitle={`Where the time went in the ${Math.min(RECENT, records.length)} most recent runs.`}>
        <PhaseBreakdown records={records.slice(0, RECENT)} onSelect={onSelect} />
      </Card>
    </div>
  )
}
