import { useState } from 'react';
import CameraCapture from './CameraCapture.jsx';
import Processing from './Processing.jsx';
import SplatViewer from './SplatViewer.jsx';
import YoutubeIngest from './YoutubeIngest.jsx';
import TopNav from './TopNav.jsx';
import HomeScreen from './HomeScreen.jsx';
import LibraryScreen from './LibraryScreen.jsx';
import PhotoEditorScreen from './PhotoEditorScreen.jsx';
import SceneBuilderScreen from './SceneBuilderScreen.jsx';
import './AppTheme.css';
import './App.css';

function App() {
    // Which dashboard tab is showing (Home / Library / Photo Editor / Scene Builder).
    const [activeTab, setActiveTab] = useState('home');

    // Full-page flows that temporarily replace the whole dashboard.
    // null means "show the normal dashboard". Otherwise one of:
    // 'capture' | 'processing' | 'result' | 'youtube'
    const [screen, setScreen] = useState(null);
    const [jobId, setJobId] = useState(null);
    const [uploadError, setUploadError] = useState(null);

    // Uploads the real batch to the backend and starts reconstruction.
    async function handleBatchReady(files) {
        setUploadError(null);
        try {
            const form = new FormData();
            for (const file of files) form.append('images', file);
            const res = await fetch('/upload', { method: 'POST', body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            setJobId(data.id);
            setScreen('processing');
        } catch (err) {
            setUploadError(err.message);
        }
    }

    function backToDashboard() {
        setScreen(null);
    }

    function resetJob() {
        setJobId(null);
        setUploadError(null);
        setScreen(null);
    }

    if (screen === 'capture') {
        return (
            <>
                {uploadError && (
                    <p className="capture-error" style={{ textAlign: 'center' }}>{uploadError}</p>
                )}
                <CameraCapture onBatchReady={handleBatchReady} onBack={backToDashboard} />
            </>
        );
    }

    if (screen === 'processing' && jobId) {
        return (
            <Processing
                jobId={jobId}
                onDone={() => setScreen('result')}
                onCancel={resetJob}
            />
        );
    }

    if (screen === 'result' && jobId) {
        // SplatViewer renders itself full-page (position: fixed, inset: 0),
        // so it is only ever used here as a standalone screen, never
        // embedded inside the tabbed dashboard layout.
        return (
            <>
                <SplatViewer url={`/jobs/${jobId}/result.ply`} />
                <div style={{ position: 'fixed', top: 16, left: 16, display: 'flex', gap: 10, zIndex: 10 }}>
                    <button className="btn btn-primary" onClick={resetJob}>
                        New scan
                    </button>
                    <a className="btn btn-ghost" href={`/jobs/${jobId}/result.ply`} download="model.ply">
                        Download .ply
                    </a>
                    <button className="btn btn-ghost" onClick={backToDashboard}>
                        Back to dashboard
                    </button>
                </div>
            </>
        );
    }

    if (screen === 'youtube') {
        return (
            <div style={{ minHeight: '100vh', background: '#0f1115', color: '#e8eaed', padding: 24 }}>
                <button className="btn btn-ghost" onClick={backToDashboard} style={{ marginBottom: 20 }}>
                    Back to dashboard
                </button>
                <YoutubeIngest />
            </div>
        );
    }

    return (
        <div className="forma-app">
            <TopNav activeTab={activeTab} onTabChange={setActiveTab} />

            {activeTab === 'home' && (
                <HomeScreen
                    onNewGeneration={() => setScreen('capture')}
                    onYoutube={() => setScreen('youtube')}
                    onNavigate={setActiveTab}
                />
            )}
            {activeTab === 'library' && (
                <LibraryScreen
                    onGenerateModel={() => setScreen('capture')}
                    onUploadPhotos={() => setScreen('capture')}
                />
            )}
            {activeTab === 'editor' && (
                <PhotoEditorScreen onGenerateModel={() => setScreen('capture')} />
            )}
            {activeTab === 'scene' && <SceneBuilderScreen />}
        </div>
    );
}

export default App;