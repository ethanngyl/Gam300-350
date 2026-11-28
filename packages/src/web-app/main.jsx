import { createRoot } from 'react-dom/client'
//import './index.css'
import App from './App.jsx'
import AppErrorBoundary from './AppErrorBoundary.jsx'
import OfflineNotice from './OfflineNotice.jsx'
// Reports this page's load time to the backend (p95 load times for admins).
import './pageLoadTiming.js'
// Applies the saved light / dark theme and follows the device on 'system'.
import './AppearanceSettings.js'

// NOTE: StrictMode is intentionally omitted. It double-mounts effects in dev, which
// would initialize the heavy WebGL splat viewer (and re-download the 350 MB .ply) twice.
// AppErrorBoundary: an error while a screen renders shows a Reload message
// instead of a blank page. OfflineNotice sits outside it, so it still shows
// (on every screen) if a page has crashed.
createRoot(document.getElementById('root')).render(
    <>
        <AppErrorBoundary>
            <App />
        </AppErrorBoundary>
        <OfflineNotice />
    </>,
)