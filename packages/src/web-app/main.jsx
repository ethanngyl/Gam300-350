import { createRoot } from 'react-dom/client'
//import './index.css'
import App from './App.jsx'

// NOTE: StrictMode is intentionally omitted. It double-mounts effects in dev, which
// would initialize the heavy WebGL splat viewer (and re-download the 350 MB .ply) twice.
//createRoot(document.getElementById('root')).render(<App />)
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

