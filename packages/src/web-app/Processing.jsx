import { useEffect, useRef, useState } from 'react'

// Friendly labels for the backend's phase names.
const PHASE_LABELS = {
  upload: 'Uploading photos',
  'colmap-features': 'Analyzing photos',
  'colmap-matching': 'Matching photos',
  'colmap-mapping': 'Recovering camera positions',
  training: 'Training 3D model',
  normalize: 'Finalizing model',
  done: 'Done',
}

/**
 * Polls /jobs/:id until the reconstruction finishes, showing phase + progress.
 * Calls onDone() when the splat is ready, onCancel() to go back. Cancel first
 * asks the server to kill the job's tool process so training doesn't keep
 * hogging the GPU for a job nobody is watching.
 */
export default function Processing({ jobId, onDone, onCancel }) {
  const [job, setJob] = useState(null)
  const [failed, setFailed] = useState(null)
  const doneRef = useRef(false)

  useEffect(() => {
    let stopped = false
    let timer

    async function poll() {
      try {
        const res = await fetch(`/jobs/${jobId}`)
        if (!res.ok) throw new Error('Job not found (did the server restart?)')
        const data = await res.json()
        if (stopped) return
        setJob(data)
        if (data.status === 'done' && !doneRef.current) {
          doneRef.current = true
          onDone()
          return
        }
        if (data.status === 'error') {
          setFailed(data.error || 'Reconstruction failed')
          return
        }
        if (data.status === 'cancelled') return // cancel() already navigated away
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

  // Free the server-side job if the user leaves without pressing Cancel:
  // closing the tab, refreshing, or the browser Back button all tear down
  // this screen while COLMAP/Brush keeps running and hogging the GPU. pagehide
  // covers tab close / navigation; the effect cleanup covers in-app unmount.
  // A finished job is left alone so its result stays downloadable, and the
  // DELETE is idempotent, so a redundant call after Cancel is harmless.
  useEffect(() => {
    function killJob() {
      if (doneRef.current) return
      fetch(`/jobs/${jobId}`, { method: 'DELETE', keepalive: true }).catch(() => {})
    }
    window.addEventListener('pagehide', killJob)
    return () => {
      window.removeEventListener('pagehide', killJob)
      killJob()
    }
  }, [jobId])

  // Kill the server-side job, then leave. keepalive lets the request finish
  // even if the page unloads; failures are ignored since we're leaving anyway.
  function cancel() {
    fetch(`/jobs/${jobId}`, { method: 'DELETE', keepalive: true }).catch(() => {})
    onCancel()
  }

  const pct = Math.round((job?.progress ?? 0) * 100)
  const label = PHASE_LABELS[job?.phase] ?? 'Working'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#0f1115',
        color: '#e8eaed',
      }}
    >
      <div style={{ width: '100%', maxWidth: 460 }}>
        {failed ? (
          <>
            <h1 style={{ marginTop: 0 }}>Something went wrong</h1>
            <p style={{ color: '#f56565' }}>{failed}</p>
            <p style={{ color: '#9aa0aa', fontSize: '0.9rem' }}>
              Common causes: too few photos, not enough overlap, or blurry/reflective
              surfaces. Try again with more, sharper, overlapping photos.
            </p>
            <button className="btn btn-primary" onClick={onCancel}>
              Start over
            </button>
          </>
        ) : (
          <>
            <h1 style={{ marginTop: 0 }}>Building your 3D model</h1>
            <p style={{ color: '#9aa0aa', fontSize: '0.9rem' }}>
              Running COLMAP and Brush on the server — a few minutes depending on
              photo count and quality.
            </p>
            <div style={{ margin: '18px 0 10px' }}>
              {label}…
              {job?.detail && (
                <span style={{ color: '#9aa0aa', marginLeft: 8 }}>{job.detail}</span>
              )}
            </div>
            <div
              style={{
                height: 10,
                background: '#2a2f3a',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #38b2ac, #4fd1c5)',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
            <div style={{ textAlign: 'right', color: '#9aa0aa', fontSize: '0.8rem', marginTop: 6 }}>
              {pct}%
            </div>
            <div style={{ marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={cancel}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
