/*!************************************************************************
\file App.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Top-level app shell. Shows the login screen until a user is signed in
(session kept in localStorage). Once signed in it renders the GENESIS
dashboard (top nav + sidebar + Home / Library / Photo Editor / Scene
Builder / Account) and the full-page flows for capturing photos, polling
reconstruction progress, viewing a finished splat result, the YouTube
ingest screen and the image gallery. Owns the active job id and uploads a
finished photo batch to the backend to kick off reconstruction.
**************************************************************************/

import { useState } from 'react';
import CameraCapture from './CameraCapture.jsx';
import Processing from './Processing.jsx';
import SplatViewer from './SplatViewer.jsx';
import YoutubeIngest from './YoutubeIngest.jsx';
import ImageGallery from './ImageGallery.jsx';
import TopNav from './TopNav.jsx';
import Sidebar from './Sidebar.jsx';
import HomeScreen from './HomeScreen.jsx';
import LibraryScreen from './LibraryScreen.jsx';
import PhotoEditorScreen from './PhotoEditorScreen.jsx';
import SceneBuilderScreen from './SceneBuilderScreen.jsx';
import LoginScreen from './LoginScreen.jsx';
import AccountScreen from './AccountScreen.jsx';
import { playSound } from '../audio/Audio.js';
import './AppTheme.css';
import './App.css';

const SESSION_STORAGE_KEY = 'genesis-session';

// Reads the saved session once on first render. Storage can be blocked
// (private windows, site data off), so every access is wrapped.
function loadSavedUser() {
    try {
        const savedSession = window.localStorage.getItem(SESSION_STORAGE_KEY);
        return savedSession ? JSON.parse(savedSession) : null;
    } catch {
        return null;
    }
}

function App() {
    const [currentUser, setCurrentUser] = useState(loadSavedUser);

    // Dashboard tab: home | library | editor | scene | account
    const [activeTab, setActiveTab] = useState('home');
    // Which Library sub-tab is open: models | photos
    const [librarySubTab, setLibrarySubTab] = useState('models');

    // Full-page flows that temporarily replace the dashboard. null shows the
    // dashboard; otherwise 'capture' | 'processing' | 'result' | 'youtube' | 'gallery'
    const [screen, setScreen] = useState(null);
    const [jobId, setJobId] = useState(null);
    const [uploadError, setUploadError] = useState(null);

    function handleLogin(user) {
        try {
            window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
        } catch {
            // Storage unavailable: the session just lasts until the page reloads.
        }
        setCurrentUser(user);
        setActiveTab('home');
    }

    function handleSignOut() {
        try {
            window.localStorage.removeItem(SESSION_STORAGE_KEY);
        } catch {
            // Nothing saved to remove.
        }
        setCurrentUser(null);
        setScreen(null);
        setActiveTab('home');
    }

    function openLibrary(subTab) {
        setLibrarySubTab(subTab);
        setActiveTab('library');
    }

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

    if (!currentUser) {
        return <LoginScreen onLogin={handleLogin} />;
    }

    if (screen === 'capture') {
        return (
            <CameraCapture
                onBatchReady={handleBatchReady}
                onBack={backToDashboard}
                uploadError={uploadError}
            />
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
        // SplatViewer renders itself full-page (position: fixed, inset: 0), so it
        // is only used here as a standalone screen, never inside the dashboard.
        return (
            <>
                <SplatViewer url={`/jobs/${jobId}/result.ply`} />
                {/* Must stay fixed above the full-page viewer, or its canvas covers the buttons. */}
                <div
                    className="genesis-overlay"
                    style={{ position: 'fixed', top: 16, left: 16, display: 'flex', gap: 10, zIndex: 10 }}
                >
                    <button className="btn btn-primary" onClick={() => { playSound('click'); resetJob(); }}>
                        New scan
                    </button>
                    <a className="btn btn-ghost" href={`/jobs/${jobId}/result.ply`} download="model.ply"
                        onClick={() => playSound('click')}>
                        Download .ply
                    </a>
                    <button className="btn btn-ghost" onClick={() => { playSound('click'); backToDashboard(); }}>
                        Back to dashboard
                    </button>
                </div>
            </>
        );
    }

    if (screen === 'gallery') {
        return <ImageGallery onBack={backToDashboard} />;
    }

    if (screen === 'youtube') {
        return (
            <div className="genesis-page">
                <button
                    className="btn btn-ghost"
                    onClick={() => {
                        playSound('click3');
                        backToDashboard();
                    }}
                    style={{ marginBottom: 20 }}
                >
                    Back to dashboard
                </button>
                <YoutubeIngest />
            </div>
        );
    }

    return (
        <div className="forma-app genesis-shell">
            <TopNav
                activeTab={activeTab}
                onTabChange={setActiveTab}
                user={currentUser}
                onOpenAccount={() => setActiveTab('account')}
                onSignOut={handleSignOut}
            />

            <div className="genesis-body">
                <Sidebar
                    activeTab={activeTab}
                    onNavigate={setActiveTab}
                    onOpenLibrary={openLibrary}
                    onNewModel={() => setScreen('capture')}
                    onYoutube={() => setScreen('youtube')}
                />

                <div className="genesis-main">
                    {activeTab === 'home' && (
                        <HomeScreen
                            userName={currentUser.name}
                            onNewGeneration={() => setScreen('capture')}
                            onYoutube={() => setScreen('youtube')}
                            onNavigate={setActiveTab}
                            onOpenLibrary={openLibrary}
                        />
                    )}
                    {activeTab === 'library' && (
                        <LibraryScreen
                            subTab={librarySubTab}
                            onSubTabChange={setLibrarySubTab}
                            onGenerateModel={() => setScreen('capture')}
                            onUploadPhotos={() => setScreen('capture')}
                        />
                    )}
                    {activeTab === 'editor' && (
                        <PhotoEditorScreen onGenerateModel={() => setScreen('capture')} />
                    )}
                    {activeTab === 'scene' && (
                        <SceneBuilderScreen onAddFromLibrary={() => openLibrary('models')} />
                    )}
                    {activeTab === 'account' && (
                        <AccountScreen user={currentUser} onSignOut={handleSignOut} />
                    )}
                </div>
            </div>
        </div>
    );
}

export default App;