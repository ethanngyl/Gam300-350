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
dashboard (a floating dock at the bottom, laid out like the Genesis second
layout) with these pages above it: Home, Library, Photo Editor, Scene
Builder, Model Viewer, Video Extractor, Feedback, Capture and Account. Capture
opens from the dock's New model button, or from Add photos with the
chosen photos already in the batch; its "Review photos first" hands the
batch to the Photo Editor. The first time each account signs in on this
browser, the walkthrough (Walkthrough.jsx) tours the dock; "Show
walkthrough" on the account page or in the account menu replays it.
Video Extractor builds go through the same processing screen: App starts
them (startVideoBuild), uploading an .mp4 while that screen already shows.
Opening a model (from Home, the Media Library or the Model Viewer, a .ply
from the user's computer, or a build that just finished) shows the model
page (ModelScreen.jsx) inside the dashboard; its back link returns to where
it was opened from. Polling reconstruction progress and the legacy image
gallery still replace the whole screen. Owns the active job id and uploads a finished photo
batch to the backend to kick off reconstruction.
**************************************************************************/

import { useCallback, useEffect, useRef, useState } from 'react';
import CameraCapture from './CameraCapture.jsx';
import Processing from './Processing.jsx';
import YoutubeIngest from './YoutubeIngest.jsx';
import ImageGallery from './ImageGallery.jsx';
import Dock from './Dock.jsx';
import HomeScreen from './HomeScreen.jsx';
import LibraryScreen from './LibraryScreen.jsx';
import PhotoEditorScreen from './PhotoEditorScreen.jsx';
import SceneBuilderScreen from './SceneBuilderScreen.jsx';
import LoginScreen from './LoginScreen.jsx';
import AccountScreen from './AccountScreen.jsx';
import FeedbackScreen from './FeedbackScreen.jsx';
import ModelViewerScreen from './ModelViewerScreen.jsx';
import ModelScreen from './ModelScreen.jsx';
import Walkthrough from './Walkthrough.jsx';
import { useUndoableState } from './useUndoableState.js';
import { NEW_SCENE_INFO, createSceneObject } from './SceneStorage.js';
import { playSound } from '../audio/Audio.js';
import { startVideoFileJob, startYoutubeJob, youtubeVideoId } from './VideoJobs.js';
import './AppTheme.css';
import './App.css';

const SESSION_STORAGE_KEY = 'genesis-session';
// Names of the pages a model can be opened from, for the model page's back link.
const TAB_LABELS = {
    home: 'Home',
    library: 'Media Library',
    viewer: 'Model Viewer',
    scene: 'Scene Builder',
};
// One flag per account (by email; guests share one), set once the
// walkthrough has been finished or skipped on this browser.
const WALKTHROUGH_SEEN_KEY_PREFIX = 'genesis-walkthrough-seen:';

function hasSeenWalkthrough(email) {
    try {
        return window.localStorage.getItem(`${WALKTHROUGH_SEEN_KEY_PREFIX}${email}`) === 'true';
    } catch {
        // Storage blocked: count it as seen, or it would show on every visit.
        return true;
    }
}

function markWalkthroughSeen(email) {
    try {
        window.localStorage.setItem(`${WALKTHROUGH_SEEN_KEY_PREFIX}${email}`, 'true');
    } catch {
        // Storage unavailable: nothing to remember it in.
    }
}

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

// Caches the signed-in user's profile, or clears it when user is null.
function saveUser(user) {
    try {
        if (user) window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
        else window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
        // Storage unavailable: the profile just isn't cached.
    }
}

function App() {
    const [currentUser, setCurrentUser] = useState(loadSavedUser);
    // True until GET /auth/me answers, so no screen fetches with a dead session.
    const [isCheckingSession, setIsCheckingSession] = useState(true);

    useEffect(() => {
        let cancelled = false;

        async function checkSession() {
            try {
                const res = await fetch('/auth/me');
                if (cancelled) return;
                if (res.ok) {
                    // Fresh copy from the server, so role changes show up.
                    const user = await res.json();
                    if (cancelled) return;
                    saveUser(user);
                    setCurrentUser(user);
                } else if (res.status === 401) {
                    // No valid session cookie: the cached profile is stale.
                    saveUser(null);
                    setCurrentUser(null);
                }
            } catch {
                // Backend unreachable: keep the cached profile so the page renders.
            } finally {
                if (!cancelled) setIsCheckingSession(false);
            }
        }

        checkSession();
        return () => { cancelled = true; };
    }, []);

    // True while the walkthrough is replaying from the account page.
    const [isReplayingWalkthrough, setIsReplayingWalkthrough] = useState(false);
    // Bumped when the walkthrough closes, so the "seen" flag is read again.
    const [, setWalkthroughCloseCount] = useState(0);

    // Page shown inside the shell:
    // home | library | editor | scene | viewer | youtube | capture | account
    // | feedback | model (the model page)
    const [activeTab, setActiveTab] = useState('home');
    // The model the model page shows: { jobId } for a server model, or
    // { localFile: { url, name, sizeBytes } } for a .ply from this computer.
    const [viewedModel, setViewedModel] = useState(null);
    // The tab the model page was opened from, for its back link.
    const [modelReturnTab, setModelReturnTab] = useState('viewer');
    // Releases a local .ply's blob URL once another model replaces it.
    const localModelUrl = viewedModel?.localFile?.url;
    useEffect(() => () => {
        if (localModelUrl) URL.revokeObjectURL(localModelUrl);
    }, [localModelUrl]);
    // Which Library sub-tab is open: models | photos
    const [librarySubTab, setLibrarySubTab] = useState('models');

    // Full-page screens that replace the whole shell. null shows the shell;
    // otherwise 'processing' | 'gallery'.
    const [screen, setScreen] = useState(null);
    const [jobId, setJobId] = useState(null);
    // A build from the Video Extractor, for the processing screen (see
    // Processing.jsx's videoBuild), or null for photo builds.
    const [videoBuild, setVideoBuild] = useState(null);
    // Stops the .mp4 upload in progress (null when nothing is uploading).
    const abortVideoUploadRef = useRef(null);
    // Counts video builds, so a cancelled build's late reply is ignored.
    const videoBuildCountRef = useRef(0);
    // Job whose training just finished; the model page asks for its name.
    // Opening a model from the Model Viewer doesn't set it, so it isn't asked there.
    const [namePromptJobId, setNamePromptJobId] = useState(null);
    const [uploadError, setUploadError] = useState(null);
    // Batch sent from Camera Capture's "Review photos first" to the Photo
    // Editor: { files, removeBackground, trainIters }. Cleared on any other
    // navigation.
    const [photosForEditor, setPhotosForEditor] = useState(null);
    // Batch sent back from the Photo Editor's "Back to camera", so Camera
    // Capture reopens with those photos: { files, removeBackground, trainIters }.
    // Cleared on any other navigation.
    const [photosForCapture, setPhotosForCapture] = useState(null);
    // Photos chosen with the dock's Add photos button, handed to the
    // capture page when it opens. Cleared on any other navigation.
    const [photosToAdd, setPhotosToAdd] = useState(null);
    // While the capture page is open, its function for adding more photos
    // to the batch (see CameraCapture's onRegisterAddFiles).
    const addToCaptureBatchRef = useRef(null);
    const registerCaptureAddFiles = useCallback((addFilesToBatch) => {
        addToCaptureBatchRef.current = addFilesToBatch;
    }, []);
    // Models placed in the Scene Builder, with their undo history, and the
    // scene's id, name and settings. Kept here so the scene survives
    // switching tabs (each page remounts when its tab opens).
    const scene = useUndoableState([]);
    const [sceneInfo, setSceneInfo] = useState(NEW_SCENE_INFO);

    function handleLogin(user) {
        saveUser(user);
        setCurrentUser(user);
        setActiveTab('home');
    }

    function handleSignOut() {
        // Ends the session on the server and clears the cookie. Not awaited:
        // a backend that is down must not stop the user signing out here.
        fetch('/auth/logout', { method: 'POST' }).catch(() => { });
        saveUser(null);
        setCurrentUser(null);
        setScreen(null);
        scene.reset([]);
        setSceneInfo(NEW_SCENE_INFO);
        setActiveTab('home');
    }

    // Every navigation goes through here: it clears a stale upload error so
    // it doesn't reappear on the next visit.
    function goToTab(tab) {
        setUploadError(null);
        setPhotosForEditor(null);
        setPhotosForCapture(null);
        setPhotosToAdd(null);
        setActiveTab(tab);
    }

    // Adds the photos chosen with the dock's Add photos button to the
    // capture page's batch, opening the page first if needed.
    function addPhotosToCapture(files) {
        if (activeTab === 'capture' && addToCaptureBatchRef.current) {
            addToCaptureBatchRef.current(files);
            return;
        }
        goToTab('capture');
        setPhotosToAdd(files);
    }

    // Opens the Photo Editor with the photos from Camera Capture loaded.
    function reviewPhotosInEditor(files, { removeBackground = false, trainIters = null } = {}) {
        goToTab('editor');
        setPhotosForEditor({ files, removeBackground, trainIters });
    }

    // Reopens Camera Capture with the photos that were in the Photo Editor.
    function returnPhotosToCapture(files, { removeBackground = false, trainIters = null } = {}) {
        goToTab('capture');
        setPhotosForCapture({ files, removeBackground, trainIters });
    }

    function openLibrary(subTab) {
        setLibrarySubTab(subTab);
        goToTab('library');
    }

    // Uploads the real batch to the backend and starts reconstruction.
    // trainIters is the training iteration cap (Fast / Normal / Detailed);
    // left out, the server uses its default.
    async function handleBatchReady(files, { removeBackground = false, trainIters = null } = {}) {
        setUploadError(null);
        try {
            const form = new FormData();
            // Text fields go before the files so the server has them as the upload streams in.
            form.append('removeBackground', String(removeBackground));
            if (trainIters) form.append('trainIters', String(trainIters));
            for (const file of files) form.append('images', file);
            const res = await fetch('/upload', { method: 'POST', body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            setVideoBuild(null);
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

    // Starts a Video Extractor build and shows the processing screen at once.
    // An .mp4 is uploaded from here (with progress); a YouTube link is sent
    // and the server downloads the video. The job id arrives afterwards.
    async function startVideoBuild({ sourceType, url, file, fps, trainIters }) {
        videoBuildCountRef.current += 1;
        const buildNumber = videoBuildCountRef.current;
        const isStillCurrent = () => videoBuildCountRef.current === buildNumber;

        setJobId(null);
        setVideoBuild({
            sourceType,
            label: sourceType === 'file' ? file.name : 'YouTube video',
            fps: Number(fps) || null,
            videoId: sourceType === 'youtube' ? youtubeVideoId(url) : null,
            uploadFraction: sourceType === 'file' ? 0 : null,
            startError: null,
        });
        // Returning from the result screen lands on Home, like photo builds.
        setActiveTab('home');
        setScreen('processing');

        try {
            let newJobId;
            if (sourceType === 'file') {
                const upload = startVideoFileJob({ file, fps, trainIters }, (fraction) => {
                    if (isStillCurrent()) setVideoBuild((build) => build && { ...build, uploadFraction: fraction });
                });
                abortVideoUploadRef.current = upload.abort;
                newJobId = await upload.promise;
            } else {
                newJobId = await startYoutubeJob({ url, fps, trainIters });
            }
            if (!isStillCurrent()) {
                // Cancelled while the request was on its way: free the job it made.
                fetch(`/jobs/${newJobId}`, { method: 'DELETE', keepalive: true }).catch(() => { });
                return;
            }
            setVideoBuild((build) => build && { ...build, uploadFraction: null });
            setJobId(newJobId);
        } catch (err) {
            // AbortError: Cancel already left the screen.
            if (err.name === 'AbortError' || !isStillCurrent()) return;
            playSound('error');
            setVideoBuild((build) => build && { ...build, startError: err.message });
        } finally {
            if (isStillCurrent()) abortVideoUploadRef.current = null;
        }
    }

    function resetJob() {
        // Stop any video upload and forget the video build.
        videoBuildCountRef.current += 1;
        abortVideoUploadRef.current?.();
        abortVideoUploadRef.current = null;
        setVideoBuild(null);
        setJobId(null);
        setUploadError(null);
        setScreen(null);
        setActiveTab('home');
    }

    // Shows a model on the model page; its back link returns to returnTab.
    function showModelPage(model, returnTab) {
        setViewedModel(model);
        setModelReturnTab(returnTab);
        goToTab('model');
    }

    // Opens a finished model from Home, the Media Library or the Model Viewer.
    function openModel(modelJobId) {
        showModelPage({ jobId: modelJobId }, activeTab);
    }

    // Opens a .ply from the user's computer (Model Viewer's "Open .ply file").
    function openLocalModel(file) {
        showModelPage({ localFile: { url: URL.createObjectURL(file), name: file.name, sizeBytes: file.size } }, 'viewer');
    }

    // Adds the model to the Scene Builder's scene and opens it there.
    function addModelToScene(model) {
        scene.set((objects) => [...objects, createSceneObject(model, objects)]);
        setSceneInfo((info) => ({ ...info, hasUnsavedChanges: true }));
        goToTab('scene');
    }

    // Shown on the dashboard the first time an account signs in here, or on request.
    const isWalkthroughOpen = Boolean(currentUser)
        && (isReplayingWalkthrough || !hasSeenWalkthrough(currentUser.email));

    // Replays the walkthrough from step 1, which points at Home's Recent section.
    function showWalkthroughAgain() {
        goToTab('home');
        setIsReplayingWalkthrough(true);
    }

    function closeWalkthrough() {
        markWalkthroughSeen(currentUser.email);
        setIsReplayingWalkthrough(false);
        setWalkthroughCloseCount((closeCount) => closeCount + 1);
    }

    if (isCheckingSession) {
        return <div className="genesis-page" />;
    }

    if (!currentUser) {
        return <LoginScreen onLogin={handleLogin} />;
    }

    if (screen === 'processing' && (jobId || videoBuild)) {
        return (
            <Processing
                jobId={jobId}
                videoBuild={videoBuild}
                onDone={() => {
                    setVideoBuild(null);
                    setNamePromptJobId(jobId);
                    setScreen(null);
                    showModelPage({ jobId }, 'home');
                }}
                onCancel={resetJob}
            />
        );
    }

    if (screen === 'gallery') {
        return <ImageGallery onBack={backToDashboard} />;
    }

    return (
        <div className="forma-app genesis-shell">
            <div className="genesis-body">
                {/* key resets the scroll position, so each page opens at the top. */}
                <div className="genesis-main" key={activeTab}>
                    {activeTab === 'home' && (
                        <HomeScreen
                            userName={currentUser.name}
                            onNewGeneration={() => goToTab('capture')}
                            onOpenLibrary={openLibrary}
                            onOpenModel={openModel}
                        />
                    )}
                    {activeTab === 'library' && (
                        <LibraryScreen
                            subTab={librarySubTab}
                            onSubTabChange={setLibrarySubTab}
                            onOpenModel={openModel}
                        />
                    )}
                    {activeTab === 'editor' && (
                        <PhotoEditorScreen
                            onGenerateModel={handleBatchReady}
                            uploadError={uploadError}
                            initialPhotos={photosForEditor}
                            onBackToCapture={returnPhotosToCapture}
                        />
                    )}
                    {activeTab === 'scene' && (
                        <SceneBuilderScreen
                            objects={scene.value}
                            onObjectsChange={scene.set}
                            onObjectsReset={scene.reset}
                            onUndo={scene.undo}
                            onRedo={scene.redo}
                            canUndo={scene.canUndo}
                            canRedo={scene.canRedo}
                            sceneInfo={sceneInfo}
                            onSceneInfoChange={setSceneInfo}
                        />
                    )}
                    {activeTab === 'viewer' && (
                        <ModelViewerScreen onOpenModel={openModel} onOpenFile={openLocalModel} />
                    )}
                    {activeTab === 'youtube' && (
                        // YoutubeIngest plays the click sound itself, so none here.
                        <YoutubeIngest onStartBuild={startVideoBuild} />
                    )}
                    {activeTab === 'capture' && (
                        // CameraCapture plays the click sound itself, so none here.
                        <CameraCapture
                            onBatchReady={handleBatchReady}
                            onReviewPhotos={reviewPhotosInEditor}
                            onBack={() => goToTab('home')}
                            uploadError={uploadError}
                            initialPhotos={photosForCapture}
                            addedFiles={photosToAdd}
                            onRegisterAddFiles={registerCaptureAddFiles}
                        />
                    )}
                    {activeTab === 'account' && (
                        <AccountScreen
                            user={currentUser}
                            onSignOut={handleSignOut}
                            onShowWalkthrough={showWalkthroughAgain}
                        />
                    )}
                    {activeTab === 'feedback' && (
                        // Guests are sent back to the login screen to sign in.
                        <FeedbackScreen user={currentUser} onSignIn={handleSignOut} />
                    )}
                    {activeTab === 'model' && viewedModel && (
                        <ModelScreen
                            jobId={viewedModel.jobId}
                            localFile={viewedModel.localFile}
                            backLabel={TAB_LABELS[modelReturnTab] ?? 'Back'}
                            showNamePrompt={Boolean(viewedModel.jobId) && namePromptJobId === viewedModel.jobId}
                            onNamePromptClose={() => setNamePromptJobId(null)}
                            onBack={() => goToTab(modelReturnTab)}
                            onOpenPhotos={() => openLibrary('photos')}
                            onAddToScene={addModelToScene}
                            onDeleted={() => goToTab(modelReturnTab === 'model' ? 'library' : modelReturnTab)}
                        />
                    )}
                </div>
            </div>

            {isWalkthroughOpen && <Walkthrough isGuest={currentUser.isGuest} onClose={closeWalkthrough} />}

            <Dock
                isPinned={isWalkthroughOpen}
                // The model page belongs with the Model Viewer.
                activeTab={activeTab === 'model' ? 'viewer' : activeTab}
                onNavigate={goToTab}
                onNewModel={() => goToTab('capture')}
                onAddPhotos={addPhotosToCapture}
                user={currentUser}
                onOpenAccount={() => goToTab('account')}
                onShowWalkthrough={showWalkthroughAgain}
                onSignOut={handleSignOut}
            />
        </div>
    );
}

export default App;