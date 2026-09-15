import { useCallback, useState } from 'react'
import Uploader from './Uploader.jsx'
import Progress from './Progress.jsx'
import SplatViewer from './SplatViewer.jsx'
import './App.css'

// Allow deep-linking straight to a job (handy for resuming / testing):
//   http://localhost:5173/?job=<id>
const initialJob = new URLSearchParams(window.location.search).get('job')

// Screens: 'upload' -> 'processing' -> 'result'
export default function App() {
  const [jobId, setJobId] = useState(initialJob)
  const [screen, setScreen] = useState(initialJob ? 'processing' : 'upload')

  const onJobCreated = useCallback((id) => {
    setJobId(id)
    setScreen('processing')
    // reflect the job in the URL so a refresh resumes it
    window.history.replaceState(null, '', `?job=${id}`)
  }, [])

  const onDone = useCallback(() => setScreen('result'), [])

  const reset = useCallback(() => {
    setJobId(null)
    setScreen('upload')
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  if (screen === 'result' && jobId) {
    return (
      <>
        <SplatViewer url={`/api/jobs/${jobId}/result.ply`} />
        <div className="topbar">
          <button className="ghost" onClick={reset}>
            ← New model
          </button>
          <a className="ghost" href={`/api/jobs/${jobId}/result.ply`} download="model.ply">
            Download .ply
          </a>
        </div>
      </>
    )
  }

  return (
    <div className="center">
      {screen === 'upload' && <Uploader onJobCreated={onJobCreated} />}
      {screen === 'processing' && jobId && (
        <Progress jobId={jobId} onDone={onDone} onCancel={reset} />
      )}
    </div>
  )
}
