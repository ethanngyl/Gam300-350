import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
//import './index.css'
import App from './App.jsx'
// Reports this page's load time to the backend (p95 load times for admins).
import './pageLoadTiming.js'
// Keeps <html data-theme> in step with the saved light / dark choice.
import './ThemePreference.js'

// NOTE: StrictMode is intentionally omitted. It double-mounts effects in dev, which
// would initialize the heavy WebGL splat viewer (and re-download the 350 MB .ply) twice.
//createRoot(document.getElementById('root')).render(<App />)
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

