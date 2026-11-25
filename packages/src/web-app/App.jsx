/*!************************************************************************
\file App.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-10-2026
\brief
Top-level app shell. Signed out, it shows the landing page
(LandingScreen.jsx), and the login screen only when the user asks to log
in (#/login) or get started (#/signup); the session is kept in
localStorage. Once signed in it renders the GENESIS dashboard, laid out
like the Genesis Figma: a top bar (TopNav.jsx) and a left sidebar
(Sidebar.jsx) around the page on wider screens, or the top bar and the
phone tab bar (Dock.jsx) at 760px wide or less (phones show Capture full
screen, without either). The pages: Home, Library, Photo Editor,
Scene Builder, Model Viewer, Video Extractor (FrameExtractor.jsx),
Feedback, Capture and Account. Capture opens from the New model dialog's
"Capture with camera" (or the tab bar on phones); its "Review photos
first" hands the batch to the Photo Editor. The first time each account
signs in on this browser, wider screens show the Figma's welcome card
(Tips.jsx): "Take the tour" shows two tips, in the Photo Editor and then
the Scene Builder's Library tab; the Video Extractor shows its own tip the
first time it opens. Phones keep the walkthrough of the tab bar
(Walkthrough.jsx). Learn in the sidebar and "Show walkthrough" on the
account page replay them.
Opening a model (from Home, the Media Library or the Model Viewer, a .ply
from the user's computer, or a build that just finished, from photos or
the Frame Extractor) shows the model page (ModelScreen.jsx) inside the
dashboard; its back link returns to where it was opened from.
New (in the sidebar, or Home's Add photos and Upload photos) opens the New
model dialog (AddPhotosDialog.jsx): upload photos or choose them from the
Media Library, then Render now or Edit manually.
Builds run in the background, as in the Figma (useBackgroundBuilds.js):
photos (from that dialog, the Photo Editor or Capture) and videos (from
the Video Extractor) are uploaded from here and the build panel
(BuildPanel.jsx) in the corner follows them while the user carries on;
leaving a page no longer cancels a build. The panel's Details opens the
full processing screen (Processing.jsx), which, like the legacy image
gallery, replaces the whole screen. Each page has its own address-bar
hash (AppRoutes.js), so the browser's Back and Forward buttons move
between pages and a refresh stays on the page.
**************************************************************************/

import { useCallback, useEffect, useRef, useState } from 'react';
import CameraCapture from './CameraCapture.jsx';
import Processing from './Processing.jsx';
import FrameExtractor from './FrameExtractor.jsx';
import ImageGallery from './ImageGallery.jsx';
import Dock from './Dock.jsx';
import Sidebar from './Sidebar.jsx';
import TopNav from './TopNav.jsx';
import LandingScreen from './LandingScreen.jsx';
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
import AddPhotosDialog from './AddPhotosDialog.jsx';
import { TipCard, WelcomeCard } from './Tips.jsx';
import { TOUR_TIPS, VIDEO_TIP } from './TipsContent.js';
import BuildPanel from './BuildPanel.jsx';
import { useBackgroundBuilds } from './useBackgroundBuilds.js';
import { useUndoableState } from './useUndoableState.js';
import { NEW_SCENE_INFO, createSceneObject } from './SceneStorage.js';
import { hashToView, viewToHash } from './AppRoutes.js';
import { useMobileView } from './useMobileView.js';
import './AppTheme.css';
import './App.css';
import './AppShell.css';
import './Pages.css';
import './MobileShell.css';
import './PaletteTheme.css';

const SESSION_STORAGE_KEY = 'genesis-session';
// Names of the pages a model can be opened from, for the model page's back link.
const TAB_LABELS = {
    home: 'Home',
    library: 'Media Library',
    viewer: 'Model Viewer',
    scene: 'Scene Builder',
    extractor: 'Video Extractor',
};

// Signed out: the landing page, or the login screen in sign-in or
// create-account mode, from the address bar (#/login, #/signup).
function authPageFromHash(hash) {
    if (hash === '#/login') return 'login';
    if (hash === '#/signup') return 'signup';
    return 'landing';
}

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
// Shown on the Frame Extractor when a reload or Forward lands on an upload
// that is no longer running (#/extractor/uploading, see AppRoutes.js).
const UPLOAD_INTERRUPTED_NOTICE =
    'Your upload stopped because the page was reloaded or left. Choose your files again to start the build.';

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

// The same for a page's first-open tip (only the Video Extractor's for now).
const TIP_SEEN_KEY_PREFIX = 'genesis-tip-seen:';

function hasSeenTip(tipId, email) {
    try {
        return window.localStorage.getItem(`${TIP_SEEN_KEY_PREFIX}${tipId}:${email}`) === 'true';
    } catch {
        return true;
    }
}

function markTipSeen(tipId, email) {
    try {
        window.localStorage.setItem(`${TIP_SEEN_KEY_PREFIX}${tipId}:${email}`, 'true');
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
    const isMobile = useMobileView();
    // Signed out: 'landing' | 'login' | 'signup' (see authPageFromHash).
    const [authPage, setAuthPage] = useState(() => authPageFromHash(window.location.hash));
    useEffect(() => {
        if (currentUser) return undefined;
        function readAuthPage() {
            setAuthPage(authPageFromHash(window.location.hash));
        }
        window.addEventListener('hashchange', readAuthPage);
        return () => window.removeEventListener('hashchange', readAuthPage);
    }, [currentUser]);

    // Signed out: opens the landing page, login or create account, with its
    // own history entry so Back returns to the previous one.
    const showAuthPage = useCallback((page) => {
        const hash = page === 'landing' ? '#/' : `#/${page}`;
        if (window.location.hash !== hash) window.history.pushState(null, '', hash);
        setAuthPage(page);
        window.scrollTo(0, 0);
    }, []);
    // True until GET /auth/me answers, so no screen fetches with a dead session.
    const [isCheckingSession, setIsCheckingSession] = useState(true);

    useEffect(() => {
        let cancelled = false;

        async function checkSession() {
            try {
                const res = await fetch('/api/v1/auth/me');
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
    // Wider screens: which tour tip is showing (index into TOUR_TIPS), or null.
    const [tourStep, setTourStep] = useState(null);
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
    // Wider screens: the page shown behind the account window, and where
    // closing it returns to.
    const [accountReturnTab, setAccountReturnTab] = useState('home');
    // The account section to open first: 'account', or 'appearance' from the gear.
    const [accountSection, setAccountSection] = useState('account');
    // Releases a local .ply's blob URL once another model replaces it.
    const localModelUrl = viewedModel?.localFile?.url;
    useEffect(() => () => {
        if (localModelUrl) URL.revokeObjectURL(localModelUrl);
    }, [localModelUrl]);
    // Which Library sub-tab is open: models | photos
    const [librarySubTab, setLibrarySubTab] = useState(initialView.librarySubTab);

    // Full-page screens that replace the whole shell. null shows the shell;
    // otherwise 'processing' (a build's Details) | 'gallery'.
    const [screen, setScreen] = useState(initialView.screen);
    const [jobId, setJobId] = useState(initialView.jobId);
    // Builds running in the background, shown in the build panel.
    const backgroundBuilds = useBackgroundBuilds(currentUser);
    const { trackJob } = backgroundBuilds;
    // A #/processing/<id> address (a refresh on a build's Details): follow that build too.
    useEffect(() => {
        if (currentUser && initialView.screen === 'processing' && initialView.jobId) trackJob(initialView.jobId);
    }, [currentUser, initialView, trackJob]);
    // The New model dialog (AddPhotosDialog.jsx) is open.
    const [isNewModelOpen, setIsNewModelOpen] = useState(false);
    // The files and settings of a Video Extractor build to bring back into
    // its form (a failed build's "Back to Video Extractor"). Cleared on any
    // other navigation.
    const [frameExtractorDraft, setFrameExtractorDraft] = useState(null);
    // Message for the Frame Extractor, e.g. after a reload stopped an upload.
    const [frameExtractorNotice, setFrameExtractorNotice] = useState(
        initialView.wasUploadInterrupted ? UPLOAD_INTERRUPTED_NOTICE : null);
    // Job whose training just finished; the model page asks for its name.
    // Opening a model from the Model Viewer doesn't set it, so it isn't asked there.
    const [namePromptJobId, setNamePromptJobId] = useState(null);
    // Build errors now show in the build panel; kept for the pages that show one.
    const [uploadError, setUploadError] = useState(null);
    // Batch sent from Camera Capture's "Review photos first" to the Photo
    // Editor: { files, removeBackground, autoCrop, trainIters }. Cleared on
    // any other navigation.
    const [photosForEditor, setPhotosForEditor] = useState(null);
    // Batch sent back from the Photo Editor's "Back to camera", so Camera
    // Capture reopens with those photos: { files, removeBackground, autoCrop, trainIters }.
    // Cleared on any other navigation.
    const [photosForCapture, setPhotosForCapture] = useState(null);
    // Models placed in the Scene Builder, with their undo history, and the
    // scene's id, name and settings. Kept here so the scene survives
    // switching tabs (each page remounts when its tab opens).
    const scene = useUndoableState([]);
    const [sceneInfo, setSceneInfo] = useState(NEW_SCENE_INFO);

    // Browser Back / Forward. Every page change gets its own history entry
    // with the page's hash (AppRoutes.js), so Back and Forward move between
    // pages instead of leaving the site. Set replaceNextRef before a change
    // whose page shouldn't come back with Back (a finished or cancelled
    // build's Details); the first sync only tidies the loaded URL.
    const replaceNextRef = useRef(true);
    // The model page's model, for Back / Forward (the listener below is set up once).
    const viewedModelRef = useRef(viewedModel);
    useEffect(() => {
        viewedModelRef.current = viewedModel;
    }, [viewedModel]);

    useEffect(() => {
        // Signed out, the address bar belongs to the landing and login pages.
        if (!currentUser) return;
        const hash = viewToHash(toRouteView({ activeTab, librarySubTab, screen, jobId, viewedModel }));
        const replace = replaceNextRef.current;
        replaceNextRef.current = false;
        if (hash === window.location.hash) return;
        if (replace) window.history.replaceState(null, '', hash);
        else window.history.pushState(null, '', hash);
    }, [currentUser, activeTab, librarySubTab, screen, jobId, viewedModel]);

    useEffect(() => {
        function handlePopState() {
            const view = fromRouteView(hashToView(window.location.hash));
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
                setFrameExtractorDraft(null);
            setFrameExtractorNotice(view.wasUploadInterrupted ? UPLOAD_INTERRUPTED_NOTICE : null);
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

    // Signs out and shows nextPage: the landing page, or the login screen
    // when a guest chose to sign in.
    function handleSignOut(nextPage = 'landing') {
        // Ends the session on the server and clears the cookie. Not awaited:
        // a backend that is down must not stop the user signing out here.
        fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => { });
        saveUser(null);
        setCurrentUser(null);
        setScreen(null);
        scene.reset([]);
        setSceneInfo(NEW_SCENE_INFO);
        setActiveTab('home');
        // The next sign-in replaces the login page's address with Home's.
        replaceNextRef.current = true;
        window.history.replaceState(null, '', nextPage === 'landing' ? '#/' : `#/${nextPage}`);
        setAuthPage(nextPage);
    }

    // Guests (who aren't really signed in) go to the login screen instead.
    function handleSignOutOrSignIn() {
        handleSignOut(currentUser?.isGuest ? 'login' : 'landing');
    }

    // Every navigation goes through here: it clears a stale upload error so
    // it doesn't reappear on the next visit.
    // (Only state setters, so it never changes and callbacks can depend on it.)
    const goToTab = useCallback((tab) => {
        setUploadError(null);
        setPhotosForEditor(null);
        setPhotosForCapture(null);
        setFrameExtractorDraft(null);
        setFrameExtractorNotice(null);
        setActiveTab(tab);
    }, []);

    // Opens the Photo Editor with the photos from Camera Capture loaded.
    function reviewPhotosInEditor(files, { removeBackground = false, autoCrop = false, trainIters = null } = {}) {
        goToTab('editor');
        setPhotosForEditor({ files, removeBackground, autoCrop, trainIters });
    }

    // Reopens Camera Capture with the photos that were in the Photo Editor.
    function returnPhotosToCapture(files, { removeBackground = false, autoCrop = false, trainIters = null } = {}) {
        goToTab('capture');
        setPhotosForCapture({ files, removeBackground, autoCrop, trainIters });
    }

    function openLibrary(subTab) {
        setLibrarySubTab(subTab);
        goToTab('library');
    }

    // Opens account settings: a window over the current page on wider
    // screens (closing returns to that page), a page of its own on phones.
    function openAccount(section = 'account') {
        if (activeTab !== 'account') setAccountReturnTab(activeTab);
        setAccountSection(section);
        goToTab('account');
    }

    // Starts a build from a photo batch in the background and returns to
    // Home, where the build panel follows it. trainIters is the training
    // iteration cap (Fast / Normal / Detailed); left out, the server uses its
    // default. autoCrop keeps only the object the photos were taken around.
    function handleBatchReady(files, { removeBackground = false, autoCrop = false, trainIters = null } = {}) {
        backgroundBuilds.startPhotoBuild(files, { removeBackground, autoCrop, trainIters });
        setIsNewModelOpen(false);
        goToTab('home');
    }

    // The New model dialog (New in the sidebar, Home's Add photos).
    const openNewModel = useCallback(() => setIsNewModelOpen(true), []);

    function backToDashboard() {
        setScreen(null);
    }

    // Leaves a build's Details screen (Processing.jsx) for the dashboard;
    // the build keeps going in the background. A useCallback, like
    // handleProcessingDone, so Processing's polling doesn't restart every
    // time App re-renders.
    const leaveBuildDetails = useCallback(() => {
        // The Details screen can't be opened again with Back.
        replaceNextRef.current = true;
        setJobId(null);
        setScreen(null);
    }, []);

    // Starts a Video Extractor build in the background (its files upload
    // from here, shown in the build panel) and returns to Home.
    function startMediaBuild({ files, fps, trainIters, removeBackground, autoCrop = false }) {
        backgroundBuilds.startMediaBuild(files, { fps, trainIters, removeBackground, autoCrop });
        goToTab('home');
    }

    // Shows a model on the model page; its back link returns to returnTab.
    const showModelPage = useCallback((model, returnTab) => {
        setViewedModel(model);
        setModelReturnTab(returnTab);
        goToTab('model');
    }, [goToTab]);

    // The build on the Details screen finished: open its model page and ask for its name.
    const handleProcessingDone = useCallback(() => {
        setNamePromptJobId(jobId);
        // The model replaces the build screen, so Back skips the finished build.
        replaceNextRef.current = true;
        setScreen(null);
        showModelPage({ jobId }, 'library');
    }, [jobId, showModelPage]);

    // The build panel's buttons.
    function openBuiltModel(build) {
        backgroundBuilds.dismissBuild(build.key);
        setNamePromptJobId(build.jobId);
        showModelPage({ jobId: build.jobId }, 'library');
    }

    function showBuildInLibrary(build) {
        backgroundBuilds.dismissBuild(build.key);
        openLibrary('models');
    }

    // A failed build: back to the Photo Editor or the Video Extractor with its files.
    function retryBuild(build) {
        backgroundBuilds.dismissBuild(build.key);
        if (build.source === 'media') {
            goToTab('extractor');
            setFrameExtractorDraft({ files: build.files, ...build.settings });
        } else {
            reviewPhotosInEditor(build.files, build.settings ?? {});
        }
    }

    function showBuildDetails(build) {
        setJobId(build.jobId);
        setScreen('processing');
    }

    // Opens a finished model from Home, the Media Library or the Model Viewer.
    function openModel(modelJobId) {
        // From the account window, the back link returns to the page behind it.
        const returnTab = activeTab === 'account' && !isMobile ? accountReturnTab : activeTab;
        showModelPage({ jobId: modelJobId }, returnTab);
    }

    // Opens a .ply or .obj from the user's computer (Model Viewer's "Open .ply / .obj file").
    function openLocalModel(file) {
        showModelPage({ localFile: { url: URL.createObjectURL(file), name: file.name, sizeBytes: file.size } }, 'viewer');
    }

    // Adds the model to the Scene Builder's scene and opens it there.
    function addModelToScene(model) {
        scene.set((objects) => [...objects, createSceneObject(model, objects)]);
        setSceneInfo((info) => ({ ...info, hasUnsavedChanges: true }));
        goToTab('scene');
    }

    // Phones: the walkthrough, shown the first time an account signs in here, or on request.
    const isFirstVisit = Boolean(currentUser) && !hasSeenWalkthrough(currentUser.email);
    const isWalkthroughOpen = Boolean(currentUser) && isMobile && (isReplayingWalkthrough || isFirstVisit);
    // Wider screens: the welcome card on Home instead, until it is answered.
    const isWelcomeOpen = !isMobile && isFirstVisit && tourStep === null && activeTab === 'home';

    // Learn and "Show walkthrough": the tour on wider screens, the walkthrough
    // on phones (from step 1, which points at Home's Recent section).
    function showWalkthroughAgain() {
        if (isMobile) {
            goToTab('home');
            setIsReplayingWalkthrough(true);
            return;
        }
        startTour();
    }

    function closeWalkthrough() {
        markWalkthroughSeen(currentUser.email);
        setIsReplayingWalkthrough(false);
        setWalkthroughCloseCount((closeCount) => closeCount + 1);
    }

    function startTour() {
        markWalkthroughSeen(currentUser.email);
        setTourStep(0);
        goToTab(TOUR_TIPS[0].page);
    }

    function nextTourStep() {
        const nextStep = tourStep + 1;
        if (nextStep >= TOUR_TIPS.length) {
            setTourStep(null);
            return;
        }
        setTourStep(nextStep);
        goToTab(TOUR_TIPS[nextStep].page);
    }

    // "I'll explore": no tour; Learn still has it.
    function skipWelcome() {
        closeWalkthrough();
    }

    function closeVideoTip() {
        markTipSeen(VIDEO_TIP.id, currentUser.email);
        setWalkthroughCloseCount((closeCount) => closeCount + 1);
    }

    if (isCheckingSession) {
        return <div className="genesis-page" />;
    }

    if (!currentUser) {
        if (authPage === 'landing') {
            return <LandingScreen onLogIn={() => showAuthPage('login')} onGetStarted={() => showAuthPage('signup')} />;
        }
        return (
            <LoginScreen
                // key: switching between login and sign-up from the landing page starts afresh.
                key={authPage}
                initialMode={authPage === 'signup' ? 'signup' : 'signin'}
                onLogin={handleLogin}
                onBackToLanding={() => showAuthPage('landing')}
            />
        );
    }

    if (screen === 'processing' && jobId) {
        return (
            <Processing
                jobId={jobId}
                onDone={handleProcessingDone}
                onCancel={leaveBuildDetails}
                onLeave={leaveBuildDetails}
            />
        );
    }

    if (screen === 'gallery') {
        return <ImageGallery onBack={backToDashboard} />;
    }

    // Wider screens show account settings as a window over the page it was
    // opened from; phones show it as a page.
    const isAccountWindowOpen = !isMobile && activeTab === 'account';
    const pageTab = isAccountWindowOpen ? accountReturnTab : activeTab;
    // The tour's tip for this page, if the tour is on it.
    const tourTip = tourStep !== null && TOUR_TIPS[tourStep].page === pageTab ? TOUR_TIPS[tourStep] : null;
    const isVideoTipOpen = !isMobile && pageTab === 'extractor' && tourStep === null
        && !isAccountWindowOpen && !hasSeenTip(VIDEO_TIP.id, currentUser.email);

    return (
        <div className={isMobile ? 'forma-app genesis-shell has-mobile-topbar' : 'forma-app genesis-shell has-app-sidebar'}>
            {/* Phones: the full-screen camera has no top bar, and the model
                page has its own header with a back button instead. */}
            {!(isMobile && (pageTab === 'capture' || pageTab === 'model')) && (
                <TopNav
                    user={currentUser}
                    isCompact={isMobile}
                    onGoHome={() => goToTab('home')}
                    onOpenModel={openModel}
                    onOpenLibrary={openLibrary}
                    onOpenSettings={() => openAccount('appearance')}
                    onOpenFeedback={() => goToTab('feedback')}
                    onOpenAccount={() => openAccount('account')}
                    onShowWalkthrough={showWalkthroughAgain}
                    onSignOut={handleSignOutOrSignIn}
                />
            )}
            {!isMobile && (
                <>
                    <Sidebar
                        // The model page belongs with the Model Viewer.
                        activeTab={activeTab === 'model' ? 'viewer' : activeTab}
                        onNavigate={goToTab}
                        onNewModel={openNewModel}
                        onLearn={showWalkthroughAgain}
                    />
                </>
            )}
            <div className="genesis-body">
                {/* key resets the scroll position, so each page opens at the top. */}
                <div className="genesis-main" key={pageTab}>
                    {pageTab === 'home' && (
                        <HomeScreen
                            onNewModel={openNewModel}
                            onNavigate={goToTab}
                            onOpenLibrary={openLibrary}
                            onOpenModel={openModel}
                        />
                    )}
                    {pageTab === 'library' && (
                        <LibraryScreen
                            subTab={librarySubTab}
                            onSubTabChange={setLibrarySubTab}
                            onOpenModel={openModel}
                        />
                    )}
                    {pageTab === 'editor' && (
                        <PhotoEditorScreen
                            onGenerateModel={handleBatchReady}
                            uploadError={uploadError}
                            initialPhotos={photosForEditor}
                            onBackToCapture={returnPhotosToCapture}
                        />
                    )}
                    {pageTab === 'scene' && (
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
                            initialLeftTab={tourTip?.id === 'scene' ? 'library' : 'scene'}
                        />
                    )}
                    {pageTab === 'viewer' && (
                        <ModelViewerScreen onOpenModel={openModel} onOpenFile={openLocalModel} />
                    )}
                    {pageTab === 'extractor' && (
                        // FrameExtractor plays the click sound itself, so none here.
                        <FrameExtractor
                            onStartBuild={startMediaBuild}
                            initialDraft={frameExtractorDraft}
                            notice={frameExtractorNotice}
                        />
                    )}
                    {pageTab === 'capture' && (
                        // CameraCapture plays the click sound itself, so none here.
                        <CameraCapture
                            onBatchReady={handleBatchReady}
                            onReviewPhotos={reviewPhotosInEditor}
                            onBack={() => goToTab('home')}
                            uploadError={uploadError}
                            initialPhotos={photosForCapture}
                        />
                    )}
                    {pageTab === 'account' && (
                        <AccountScreen
                            key={accountSection}
                            user={currentUser}
                            initialSection={accountSection}
                            onOpenModel={openModel}
                            onOpenLibrary={openLibrary}
                            onSignOut={handleSignOutOrSignIn}
                            onShowWalkthrough={showWalkthroughAgain}
                        />
                    )}
                    {pageTab === 'feedback' && (
                        // Guests are sent back to the login screen to sign in.
                        <FeedbackScreen user={currentUser} onSignIn={() => handleSignOut('login')} />
                    )}
                    {pageTab === 'model' && viewedModel && (
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

            {isAccountWindowOpen && (
                <AccountScreen
                    key={accountSection}
                    user={currentUser}
                    isModal
                    initialSection={accountSection}
                    onClose={() => goToTab(accountReturnTab)}
                    onOpenModel={openModel}
                    onOpenLibrary={openLibrary}
                    onSignOut={handleSignOutOrSignIn}
                    onShowWalkthrough={showWalkthroughAgain}
                />
            )}

            {isNewModelOpen && (
                <AddPhotosDialog
                    onClose={() => setIsNewModelOpen(false)}
                    onRenderNow={handleBatchReady}
                    onEditManually={(files, settings) => {
                        setIsNewModelOpen(false);
                        reviewPhotosInEditor(files, settings);
                    }}
                    onOpenCamera={() => {
                        setIsNewModelOpen(false);
                        goToTab('capture');
                    }}
                />
            )}

            <BuildPanel
                builds={backgroundBuilds.builds}
                onOpenModel={openBuiltModel}
                onShowLibrary={showBuildInLibrary}
                onRetry={retryBuild}
                onCancel={backgroundBuilds.cancelBuild}
                onDismiss={backgroundBuilds.dismissBuild}
                onShowDetails={showBuildDetails}
            />

            {isWalkthroughOpen && <Walkthrough isGuest={currentUser.isGuest} onClose={closeWalkthrough} />}
            {isWelcomeOpen && <WelcomeCard onTakeTour={startTour} onExplore={skipWelcome} />}
            {tourTip && (
                <TipCard
                    key={tourTip.id}
                    tip={tourTip}
                    stepText={`${tourStep + 1} of ${TOUR_TIPS.length}`}
                    primaryLabel={tourStep + 1 < TOUR_TIPS.length ? 'Next' : 'Done'}
                    onPrimary={nextTourStep}
                    secondaryLabel={tourStep + 1 < TOUR_TIPS.length ? 'Skip tour' : null}
                    onSecondary={() => setTourStep(null)}
                />
            )}
            {isVideoTipOpen && <TipCard tip={VIDEO_TIP} primaryLabel="Got it" onPrimary={closeVideoTip} />}

            {isMobile && pageTab !== 'capture' && (
                <Dock
                    // The model page belongs with the Media Library, where
                    // phones open models from.
                    activeTab={activeTab === 'model' ? 'library' : activeTab}
                    onNavigate={goToTab}
                    onNewModel={() => goToTab('capture')}
                />
            )}
        </div>
    );
}

export default App;