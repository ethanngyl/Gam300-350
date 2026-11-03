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
Builder, Model Viewer, Frame Extractor, Feedback, Capture and Account. Capture
opens from the dock's New model button, or from Add photos with the
chosen photos already in the batch; its "Review photos first" hands the
batch to the Photo Editor. The first time each account signs in on this
browser, the walkthrough (Walkthrough.jsx) tours the dock; "Show
walkthrough" on the account page or in the account menu replays it.
Opening a model (from Home, the Media Library or the Model Viewer, a .ply
from the user's computer, or a build that just finished, from photos or
the Frame Extractor) shows the model page (ModelScreen.jsx) inside the
dashboard; its back link returns to where it was opened from. Polling
reconstruction progress and the legacy image gallery still replace the
whole screen. Owns the active job id and uploads a finished photo batch
to the backend to kick off reconstruction. Frame Extractor builds go
through the same processing screen: App uploads the media (startMediaBuild)
while that screen already shows the upload as its first step. Each page has its own
address-bar hash (AppRoutes.js), so the browser's Back and Forward buttons
move between pages and a refresh stays on the page; leaving a build in
progress with Back asks first, since leaving cancels it.
**************************************************************************/

import { useCallback, useEffect, useRef, useState } from 'react';
import CameraCapture from './CameraCapture.jsx';
import Processing from './Processing.jsx';
import FrameExtractor from './FrameExtractor.jsx';
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
import { hashToView, viewToHash } from './AppRoutes.js';
import { uploadMedia } from './mediaJobs.js';
import { playSound } from '../audio/Audio.js';
import './AppTheme.css';
import './App.css';

const SESSION_STORAGE_KEY = 'genesis-session';
// Names of the pages a model can be opened from, for the model page's back link.
const TAB_LABELS = {
    home: 'Home',
    library: 'Media Library',
    viewer: 'Model Viewer',
    scene: 'Scene Builder',
    extractor: 'Frame Extractor',
};

// AppRoutes.js names the model page by its old full-page screens: 'result'
// (a server model, #/model/<jobId>) or 'local-model' (a .ply from this
// computer, #/viewer/file). These two convert between that and App's state.
function toRouteView({ activeTab, librarySubTab, screen, jobId, viewedModel }) {
    if (!screen && activeTab === 'model' && viewedModel) {
        return viewedModel.jobId
            ? { activeTab, librarySubTab, screen: 'result', jobId: viewedModel.jobId }
            : { activeTab: 'viewer', librarySubTab, screen: 'local-model', jobId: null };
    }
    return { activeTab, librarySubTab, screen, jobId };
}

// A route view as App state: the model page is the 'model' tab, with the
// server model to show (a local .ply can't be reopened from a hash alone).
function fromRouteView(view) {
    if (view.screen === 'result') {
        return { ...view, activeTab: 'model', screen: null, jobId: null, modelJobId: view.jobId };
    }
    if (view.screen === 'local-model') return { ...view, screen: null, isLocalModel: true };
    return view;
}
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

    // The page in the address bar when the app loads (a refresh or a link,
    // see AppRoutes.js). A .ply opened from this computer can't survive a
    // reload, so that one opens the Model Viewer instead.
    const [initialView] = useState(() => {
        // A local .ply can't survive a reload, so #/viewer/file opens the Model Viewer.
        return fromRouteView(hashToView(window.location.hash));
    });

    // Page shown inside the shell:
    // home | library | editor | scene | viewer | extractor | capture | account
    // | feedback | model (the model page)
    const [activeTab, setActiveTab] = useState(initialView.activeTab);
    // The model the model page shows: { jobId } for a server model, or
    // { localFile: { url, name, sizeBytes } } for a .ply from this computer.
    const [viewedModel, setViewedModel] = useState(
        initialView.modelJobId ? { jobId: initialView.modelJobId } : null);
    // The tab the model page was opened from, for its back link.
    const [modelReturnTab, setModelReturnTab] = useState('viewer');
    // Releases a local .ply's blob URL once another model replaces it.
    const localModelUrl = viewedModel?.localFile?.url;
    useEffect(() => () => {
        if (localModelUrl) URL.revokeObjectURL(localModelUrl);
    }, [localModelUrl]);
    // Which Library sub-tab is open: models | photos
    const [librarySubTab, setLibrarySubTab] = useState(initialView.librarySubTab);

    // Full-page screens that replace the whole shell. null shows the shell;
    // otherwise 'processing' | 'gallery'.
    const [screen, setScreen] = useState(initialView.screen);
    const [jobId, setJobId] = useState(initialView.jobId);
    // A build from the Frame Extractor, for the processing screen (see
    // Processing.jsx's mediaBuild), or null for photo builds.
    const [mediaBuild, setMediaBuild] = useState(null);
    // Stops the media upload in progress (null when nothing is uploading).
    const abortMediaUploadRef = useRef(null);
    // Counts media builds, so a cancelled build's late reply is ignored.
    const mediaBuildCountRef = useRef(0);
    // Releases the processing screen's preview of the first file once the build ends.
    const mediaPreviewUrl = mediaBuild?.previewUrl;
    useEffect(() => () => {
        if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    }, [mediaPreviewUrl]);
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

    // Browser Back / Forward. Every page change gets its own history entry
    // with the page's hash (AppRoutes.js), so Back and Forward move between
    // pages instead of leaving the site. Set replaceNextRef before a change
    // whose page shouldn't come back with Back (a finished or cancelled
    // build); the first sync only tidies the loaded URL.
    const replaceNextRef = useRef(true);
    // The hash of the page on screen, for putting it back when leaving is refused.
    const currentHashRef = useRef(window.location.hash);
    // While a page would lose work by being left (a build in progress), its
    // function that asks the user first; returns true if they may leave.
    const leaveGuardRef = useRef(null);
    const registerLeaveGuard = useCallback((guard) => {
        leaveGuardRef.current = guard;
    }, []);
    // The model page's model, for Back / Forward (the listener below is set up once).
    const viewedModelRef = useRef(viewedModel);
    useEffect(() => {
        viewedModelRef.current = viewedModel;
    }, [viewedModel]);

    useEffect(() => {
        const hash = viewToHash(toRouteView({ activeTab, librarySubTab, screen, jobId, viewedModel }));
        const replace = replaceNextRef.current;
        replaceNextRef.current = false;
        currentHashRef.current = hash;
        if (hash === window.location.hash) return;
        if (replace) window.history.replaceState(null, '', hash);
        else window.history.pushState(null, '', hash);
    }, [activeTab, librarySubTab, screen, jobId, viewedModel]);

    useEffect(() => {
        function handlePopState() {
            if (leaveGuardRef.current && !leaveGuardRef.current()) {
                // Stay: put this page back as the newest entry.
                window.history.pushState(null, '', currentHashRef.current);
                return;
            }
            const view = fromRouteView(hashToView(window.location.hash));
            // Leaving a media build mid-upload: stop sending the files.
            if (view.screen !== 'processing') stopMediaBuild();
            if (view.isLocalModel) {
                if (viewedModelRef.current?.localFile) view.activeTab = 'model';
                // That file is gone (the page was reloaded): open the Model Viewer.
                else replaceNextRef.current = true;
            }
            if (view.modelJobId && viewedModelRef.current?.jobId !== view.modelJobId) {
                setViewedModel({ jobId: view.modelJobId });
            }
            // Like goToTab: one-off hand-offs between pages don't survive navigation.
            setUploadError(null);
            setPhotosForEditor(null);
            setPhotosForCapture(null);
            setPhotosToAdd(null);
            setActiveTab(view.activeTab);
            if (view.activeTab === 'library') setLibrarySubTab(view.librarySubTab);
            setScreen(view.screen);
            if (view.jobId) setJobId(view.jobId);
        }
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

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
            setMediaBuild(null);
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

    // Stops a media upload in progress and forgets the media build.
    // (Only refs and state setters, so the Back / Forward listener can use it.)
    function stopMediaBuild() {
        mediaBuildCountRef.current += 1;
        abortMediaUploadRef.current?.();
        abortMediaUploadRef.current = null;
        setMediaBuild(null);
    }

    function resetJob() {
        // The build or model screen being left can't be opened again with Back.
        replaceNextRef.current = true;
        // A cancelled media build returns to the Frame Extractor, photos to Home.
        const returnTab = mediaBuild ? 'extractor' : 'home';
        stopMediaBuild();
        setJobId(null);
        setUploadError(null);
        setScreen(null);
        setActiveTab(returnTab);
    }

    // Starts a Frame Extractor build and shows the processing screen at once,
    // uploading the files from here (with progress). The job id arrives after.
    async function startMediaBuild({ files, fps, trainIters, removeBackground }) {
        mediaBuildCountRef.current += 1;
        const buildNumber = mediaBuildCountRef.current;
        const isStillCurrent = () => mediaBuildCountRef.current === buildNumber;
        const firstFile = files[0];

        setJobId(null);
        setMediaBuild({
            label: files.length === 1 ? firstFile.name : `${files.length} files`,
            fileCount: files.length,
            fps,
            removeBackground,
            previewUrl: URL.createObjectURL(firstFile),
            isGif: /\.gif$/i.test(firstFile.name),
            uploadFraction: 0,
            startError: null,
        });
        setScreen('processing');

        try {
            const newJobId = await uploadMedia(
                files,
                { fps, trainIters, removeBackground },
                (xhr) => {
                    abortMediaUploadRef.current = () => xhr.abort();
                },
                (fraction) => {
                    if (isStillCurrent()) setMediaBuild((build) => build && { ...build, uploadFraction: fraction });
                },
            );
            if (!isStillCurrent()) {
                // Cancelled while the upload was finishing: free the job it made.
                fetch(`/jobs/${newJobId}`, { method: 'DELETE', keepalive: true }).catch(() => { });
                return;
            }
            setMediaBuild((build) => build && { ...build, uploadFraction: null });
            // The build's own address replaces the Frame Extractor's in the history.
            replaceNextRef.current = true;
            setJobId(newJobId);
        } catch (err) {
            // { aborted: true }: Cancel or Back already left the screen.
            if (err?.aborted || !isStillCurrent()) return;
            playSound('error');
            setMediaBuild((build) => build && { ...build, startError: err.message });
        } finally {
            if (isStillCurrent()) abortMediaUploadRef.current = null;
        }
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

    if (screen === 'processing' && (jobId || mediaBuild)) {
        return (
            <Processing
                jobId={jobId}
                mediaBuild={mediaBuild}
                onDone={() => {
                    // A media build's model page links back to the Frame Extractor.
                    const returnTab = mediaBuild ? 'extractor' : 'home';
                    stopMediaBuild();
                    setNamePromptJobId(jobId);
                    // The model replaces the build screen, so Back skips the finished build.
                    replaceNextRef.current = true;
                    setScreen(null);
                    showModelPage({ jobId }, returnTab);
                }}
                onCancel={resetJob}
                onRegisterLeaveGuard={registerLeaveGuard}
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
                    {activeTab === 'extractor' && (
                        // FrameExtractor plays the click sound itself, so none here.
                        <FrameExtractor onStartBuild={startMediaBuild} />
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