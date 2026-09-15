import { useEffect, useRef, useState } from 'react'

// Friendly labels for the backend's phase names.
const PHASE_LABELS = {
  upload: 'Uploading photos',
  'colmap-features': 'Analyzing photos',
  'colmap-matching': 'Matching photos',
  'colmap-mapping': 'Recovering camera positions',
  training: 'Training 3D model',
  done: 'Done',
}

/**
 * Polls a job until it finishes, showing phase + progress. Calls onDone(jobId)
 * when the splat is ready. Lets the user start over via onCancel.
 */
export default function Progress({ jobId, onDone, onCancel }) {
  const [job, setJob] = useState(null)
  const [failed, setFailed] = useState(null)
  const doneRef = useRef(false)

  useEffect(() => {
    let timer
    let stopped = false

    async function poll() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`)
        if (!res.ok) throw new Error('Job not found (did the server restart?)')
        const data = await res.json()
        if (stopped) return
        setJob(data)
        if (data.status === 'done' && !doneRef.current) {
          doneRef.current = true
          onDone(jobId)
          return
        }
        if (data.status === 'error') {
          setFailed(data.error || 'Reconstruction failed')
          return
        }
      } catch (err) {
        if (!stopped) setFailed(err.message)
        return
      }
      timer = setTimeout(poll, 1500)
    }
    poll()

    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [jobId, onDone])

  const pct = Math.round((job?.progress ?? 0) * 100)
  const label = PHASE_LABELS[job?.phase] ?? 'Working…'

  if (failed) {
    return (
      <div className="card">
        <h1>Something went wrong</h1>
        <p className="error">{failed}</p>
        <p className="subtitle">
          Common causes: too few photos, not enough overlap, or blurry/reflective
          surfaces. Try again with more, sharper, overlapping photos.
        </p>
        <div className="actions">
          <button className="primary" onClick={onCancel}>
            Start over
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <h1>Building your 3D model</h1>
      <p className="subtitle">
        This runs COLMAP and Brush on the server — a few minutes depending on photo
        count and quality settings.
      </p>

      <div className="phase">{label}…</div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="pct">{pct}%</div>

      {job?.logTail?.length > 0 && (
        <details className="logbox">
          <summary>Show log</summary>
          <pre>{job.logTail.slice(-12).join('\n')}</pre>
        </details>
      )}

      <div className="actions">
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
