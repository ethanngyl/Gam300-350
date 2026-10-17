/*!************************************************************************
\file App.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-10-2026
\brief
Top-level app shell. Shows the login screen until a user is signed in
(session kept in localStorage). Once signed in it renders the GENESIS
dashboard (top nav + sidebar) with these pages inside it: Home, Library,
Photo Editor, Scene Builder, Model Viewer, YouTube Extractor, Capture and
Account. YouTube Extractor and Capture are opened from the sidebar.
Polling reconstruction progress, the finished splat result, a local .ply
opened from the Model Viewer and the legacy image gallery still replace
the whole screen. Owns the active job id and uploads a finished photo
batch to the backend to kick off reconstruction.
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
import ModelViewerScreen from './ModelViewerScreen.jsx';
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

    // Page shown inside the shell:
    // home | library | editor | scene | viewer | youtube | capture | account
    const [activeTab, setActiveTab] = useState('home');
    // Which Library sub-tab is open: models | photos
    const [librarySubTab, setLibrarySubTab] = useState('models');

    // Full-page screens that replace the whole shell. null shows the shell;
    // otherwise 'processing' | 'result' | 'local-model' | 'gallery'.
    const [screen, setScreen] = useState(null);
    const [jobId, setJobId] = useState(null);
    // A .ply opened from the user's computer in the Model Viewer: { url, name }
    const [localModel, setLocalModel] = useState(null);
    const [uploadError, setUploadError] = useState(null);
    // Whether the sidebar drawer is open (phones only).
    const [isMenuOpen, setIsMenuOpen] = useState(false);

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
        setIsMenuOpen(false);
        setActiveTab('home');
    }

    // Every navigation goes through here: it closes the phone drawer and
    // clears a stale upload error so it doesn't reappear on the next visit.
    function goToTab(tab) {
        setIsMenuOpen(false);
        setUploadError(null);
        setActiveTab(tab);
    }

    function openLibrary(subTab) {
        setLibrarySubTab(subTab);
        goToTab('library');
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
            // The capture page closes once processing starts, so returning
            // from the result screen lands on Home instead of an empty capture.
            setActiveTab('home');
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
        setActiveTab('home');
    }

    // Opens a finished model in the full-page splat viewer (the same screen
    // the reconstruction flow ends on). Back to dashboard returns to the page
    // it was opened from (Library or Model Viewer).
    function openModel(modelJobId) {
        setJobId(modelJobId);
        setScreen('result');
    }

    function openLocalModel(file) {
        setLocalModel({ url: URL.createObjectURL(file), name: file.name });
        setScreen('local-model');
    }

    function closeLocalModel() {
        // Release the file the blob URL holds on to.
        URL.revokeObjectURL(localModel.url);
        setLocalModel(null);
        setScreen(null);
    }

    if (!currentUser) {
        return <LoginScreen onLogin={handleLogin} />;
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
                    <button
                        className="btn btn-primary"
                        onClick={() => {
                            playSound('click');
                            resetJob();
                            goToTab('capture');
                        }}
                    >
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

    if (screen === 'local-model' && localModel) {
        return (
            <>
                <SplatViewer url={localModel.url} />
                <div
                    className="genesis-overlay"
                    style={{ position: 'fixed', top: 16, left: 16, display: 'flex', gap: 10, alignItems: 'center', zIndex: 10 }}
                >
                    <button className="btn btn-ghost" onClick={() => { playSound('click'); closeLocalModel(); }}>
                        Back to dashboard
                    </button>
                    <span style={{ color: '#f4fbfd', fontSize: 13, opacity: 0.8 }}>{localModel.name}</span>
                </div>
            </>
        );
    }

    if (screen === 'gallery') {
        return <ImageGallery onBack={backToDashboard} />;
    }

    return (
        <div className="forma-app genesis-shell">
            <TopNav
                activeTab={activeTab}
                onTabChange={goToTab}
                user={currentUser}
                onOpenAccount={() => goToTab('account')}
                onSignOut={handleSignOut}
                onToggleMenu={() => setIsMenuOpen((wasOpen) => !wasOpen)}
            />

            <div className="genesis-body">
                {/* Dark overlay behind the phone drawer; tapping it closes the drawer. */}
                {isMenuOpen && (
                    <button
                        type="button"
                        className="genesis-backdrop"
                        aria-label="Close menu"
                        onClick={() => setIsMenuOpen(false)}
                    />
                )}

                <Sidebar
                    activeTab={activeTab}
                    librarySubTab={librarySubTab}
                    onNavigate={goToTab}
                    onOpenLibrary={openLibrary}
                    onNewModel={() => goToTab('capture')}
                    isOpen={isMenuOpen}
                    onClose={() => setIsMenuOpen(false)}
                />

                {/* key resets the scroll position, so each page opens at the top. */}
                <div className="genesis-main" key={activeTab}>
                    {activeTab === 'home' && (
                        <HomeScreen
                            userName={currentUser.name}
                            onNewGeneration={() => goToTab('capture')}
                            onYoutube={() => goToTab('youtube')}
                            onNavigate={goToTab}
                            onOpenLibrary={openLibrary}
                        />
                    )}
                    {activeTab === 'library' && (
                        <LibraryScreen
                            subTab={librarySubTab}
                            onSubTabChange={setLibrarySubTab}
                            onGenerateModel={() => goToTab('capture')}
                            onUploadPhotos={() => goToTab('capture')}
                            onOpenModel={openModel}
                        />
                    )}
                    {activeTab === 'editor' && (
                        <PhotoEditorScreen onGenerateModel={() => goToTab('capture')} />
                    )}
                    {activeTab === 'scene' && (
                        <SceneBuilderScreen onAddFromLibrary={() => openLibrary('models')} />
                    )}
                    {activeTab === 'viewer' && (
                        <ModelViewerScreen onOpenModel={openModel} onOpenFile={openLocalModel} />
                    )}
                    {activeTab === 'youtube' && (
                        // YoutubeIngest plays the click sound itself, so none here.
                        <YoutubeIngest onBack={() => goToTab('home')} />
                    )}
                    {activeTab === 'capture' && (
                        // CameraCapture plays the click sound itself, so none here.
                        <CameraCapture
                            onBatchReady={handleBatchReady}
                            onBack={() => goToTab('home')}
                            uploadError={uploadError}
                        />
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