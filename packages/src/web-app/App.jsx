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
(Sidebar.jsx) around the page on wider screens. At 760px wide or less it
follows JM's mobile Figma: the top bar and, on Home, the Library and the
model page, a pink camera button that opens Capture (shown full screen).
Phones reach the Library from Home's "View all", models by tapping them,
the Photo Editor after Capture or by picking photos from Capture's gallery
button, and the Video Extractor by picking a video there; Scene Builder
shows a note that it needs a larger screen. The pages: Home, Library,
Photo Editor, Scene Builder, Model Viewer, Video Extractor
(FrameExtractor.jsx), Feedback, Capture and Account. Capture also opens
from the New model dialog's "Capture with camera"; its "Review photos
first" hands the batch to the Photo Editor. The first time each account
signs in on this browser it is asked "How do you want to start?"
(StartScreen.jsx: upload photos, use a video or take pictures), then Home
shows the Figma's welcome card (Tips.jsx), whose "Take the tour" starts
the walkthrough (Walkthrough.jsx) of each page in the sidebar (on phones:
the camera button, View all and the profile) and the profile. The Video Extractor shows its own tip the
first time it opens. Learn in the sidebar and "Show walkthrough" replay
the walkthrough.
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
Leaving Capture, the Photo Editor or the Video Extractor while it holds
photos or a video (by any link, Back, signing out, or the build panel)
asks "Discard your photos?" first, and reloading or closing the tab gets
the browser's own warning. Moving the photos on (Capture to the Photo
Editor and back) or starting a build from them doesn't ask; a video picked
in Capture asks if it would leave shots behind. The page clears the flag
itself as it closes, so a choice that keeps it open (New model, then
Cancel) still asks next time.
**************************************************************************/

import { useCallback, useEffect, useRef, useState } from 'react';
import CameraCapture from './CameraCapture.jsx';
import Processing from './Processing.jsx';
import FrameExtractor from './FrameExtractor.jsx';
import ImageGallery from './ImageGallery.jsx';
import Sidebar from './Sidebar.jsx';
import TopNav from './TopNav.jsx';
import Icon from './Icons.jsx';
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
import ActionDialog from './ActionDialog.jsx';
import { TipCard, WelcomeCard } from './Tips.jsx';
import { VIDEO_TIP } from './TipsContent.js';
import StartScreen from './StartScreen.jsx';
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

// Phones: the pages that show the camera button (JM's mobile Figma).
const CAMERA_BUTTON_PAGES = ['home', 'library', 'model'];

// The same for "How do you want to start?" (StartScreen.jsx), answered once
// per account on this browser.
const START_SEEN_KEY_PREFIX = 'genesis-start-seen:';

function hasSeenStart(email) {
    try {
        return window.localStorage.getItem(`${START_SEEN_KEY_PREFIX}${email}`) === 'true';
    } catch {
        return true;
    }
}

function markStartSeen(email) {
    try {
        window.localStorage.setItem(`${START_SEEN_KEY_PREFIX}${email}`, 'true');
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

    // True while the walkthrough is open on request (Take the tour, Learn,
    // Show walkthrough).
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
    // A #/processing/<id> address (a refresh on a build's Details): follow
    // that build too. Only once, so a build closed in the panel doesn't come
    // back after signing out and in again.
    const hasTrackedInitialJobRef = useRef(false);
    useEffect(() => {
        if (hasTrackedInitialJobRef.current || !currentUser) return;
        hasTrackedInitialJobRef.current = true;
        if (initialView.screen === 'processing' && initialView.jobId) trackJob(initialView.jobId);
    }, [currentUser, initialView, trackJob]);
    // The New model dialog (AddPhotosDialog.jsx) is open.
    const [isNewModelOpen, setIsNewModelOpen] = useState(false);
    // The files and settings of a Video Extractor build to bring back into
    // its form (a failed build's "Back to Video Extractor"). Cleared on any
    // other navigation.
    const [frameExtractorDraft, setFrameExtractorDraft] = useState(null);
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

    // Whether the page holds photos or a video that leaving would throw
    // away (Capture, the Photo Editor and the Video Extractor report it).
    const hasUnsavedWorkRef = useRef(false);
    // The address of the page shown now, for staying put on Back (below).
    const currentHashRef = useRef(window.location.hash);
    // What to do if the user chooses Discard in "Discard your photos?", or
    // null while it isn't open.
    const [pendingLeave, setPendingLeave] = useState(null);
    const setHasUnsavedWork = useCallback((hasUnsavedWork) => {
        hasUnsavedWorkRef.current = hasUnsavedWork;
    }, []);
    // The page shown now (as pageTab below), so going to it again, or Back
    // from the account window on wider screens, doesn't ask.
    const pageTabRef = useRef(activeTab);
    const isMobileRef = useRef(isMobile);
    useEffect(() => {
        pageTabRef.current = !isMobile && activeTab === 'account' ? accountReturnTab : activeTab;
        isMobileRef.current = isMobile;
    }, [isMobile, activeTab, accountReturnTab]);
    // Set just before Discard goes Back again, so that Back doesn't ask twice.
    const isLeavingByBackRef = useRef(false);
    // Changed by each hand-off of photos or videos to a page (handOff below),
    // so the page starts again with them even when it is already open.
    const [handOffKey, setHandOffKey] = useState(0);

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
        currentHashRef.current = hash;
        if (hash === window.location.hash) return;
        if (replace) window.history.replaceState(null, '', hash);
        else window.history.pushState(null, '', hash);
    }, [currentUser, activeTab, librarySubTab, screen, jobId, viewedModel]);

    useEffect(() => {
        function handlePopState() {
            const view = fromRouteView(hashToView(window.location.hash));
            // Back / Forward from a page holding photos or a video: stay (put
            // its address back) and ask first; Discard goes back again. Not
            // when the page stays on screen: the same page, or (wider
            // screens) the account window opening or closing over it.
            const isPageKept = !view.screen && (view.activeTab === pageTabRef.current
                || (!isMobileRef.current && view.activeTab === 'account'));
            if (isLeavingByBackRef.current) {
                isLeavingByBackRef.current = false;
            } else if (hasUnsavedWorkRef.current && !isPageKept) {
                window.history.pushState(null, '', currentHashRef.current);
                setPendingLeave(() => () => {
                    isLeavingByBackRef.current = true;
                    window.history.back();
                });
                return;
            }
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
        confirmLeave(() => handleSignOut(currentUser?.isGuest ? 'login' : 'landing'));
    }

    // Switches page. It clears a stale upload error so it doesn't reappear on
    // the next visit, and the one-off hand-offs between pages. Used directly
    // only where the photos on the page go with the user (to another page or
    // into a build); everything else goes through goToTab, which asks first.
    // (Only state setters, so it never changes and callbacks can depend on it.)
    const switchTab = useCallback((tab) => {
        setUploadError(null);
        setPhotosForEditor(null);
        setPhotosForCapture(null);
        setFrameExtractorDraft(null);
        setActiveTab(tab);
    }, []);

    // Runs leave() now, or after "Discard your photos?" if the page holds
    // photos or a video.
    const confirmLeave = useCallback((leave) => {
        if (!hasUnsavedWorkRef.current) {
            leave();
            return;
        }
        setPendingLeave(() => leave);
    }, [setPendingLeave]);

    // The flag is left for the page to clear as it closes: some choices
    // (New model) keep the page open, and it must still ask next time.
    function discardAndLeave() {
        const leave = pendingLeave;
        setPendingLeave(null);
        leave();
    }

    // Reloading or closing the tab with photos or a video: the browser asks.
    useEffect(() => {
        function warnBeforeUnload(event) {
            if (!hasUnsavedWorkRef.current) return;
            event.preventDefault();
            event.returnValue = '';
        }
        window.addEventListener('beforeunload', warnBeforeUnload);
        return () => window.removeEventListener('beforeunload', warnBeforeUnload);
    }, []);

    // Every other navigation goes through here: leaving a page that holds
    // photos or a video asks first.
    const goToTab = useCallback((tab) => {
        if (tab === pageTabRef.current) switchTab(tab);
        else confirmLeave(() => switchTab(tab));
    }, [switchTab, confirmLeave]);

    // Opens a page with photos or videos handed to it; it starts again with
    // them even if it is already open (New model's Edit manually from the
    // Photo Editor, say).
    function handOff(tab) {
        switchTab(tab);
        setHandOffKey((key) => key + 1);
    }

    // Opens the Photo Editor with the photos from Camera Capture loaded.
    function reviewPhotosInEditor(files, { removeBackground = false, autoCrop = false, trainIters = null } = {}) {
        handOff('editor');
        setPhotosForEditor({ files, removeBackground, autoCrop, trainIters });
    }

    // Reopens Camera Capture with the photos that were in the Photo Editor.
    function returnPhotosToCapture(files, { removeBackground = false, autoCrop = false, trainIters = null } = {}) {
        handOff('capture');
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
        // Wider screens: a window over the page, which stays as it is.
        if (isMobile) goToTab('account');
        else switchTab('account');
    }

    // Starts a build from a photo batch in the background and returns to
    // Home, where the build panel follows it. trainIters is the training
    // iteration cap (Fast / Normal / Detailed); left out, the server uses its
    // default. autoCrop keeps only the object the photos were taken around.
    function handleBatchReady(files, { removeBackground = false, autoCrop = false, trainIters = null } = {}) {
        backgroundBuilds.startPhotoBuild(files, { removeBackground, autoCrop, trainIters });
        setIsNewModelOpen(false);
        switchTab('home');
    }

    // The New model dialog (New in the sidebar, Home's Add photos).
    // Its photos would replace the page's, so it asks first too.
    const openNewModel = useCallback(() => confirmLeave(() => setIsNewModelOpen(true)), [confirmLeave]);

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
        switchTab('home');
    }

    // Shows a model on the model page; its back link returns to returnTab.
    const showModelPage = useCallback((model, returnTab) => {
        setViewedModel(model);
        setModelReturnTab(returnTab);
        goToTab('model');
    }, [goToTab]);

    // The build on the Details screen finished: open its model page and ask
    // for its name. Its "Model ready" card is closed, so it doesn't ask again.
    const { dismissJob } = backgroundBuilds;
    const handleProcessingDone = useCallback(() => {
        dismissJob(jobId);
        setNamePromptJobId(jobId);
        // The model replaces the build screen, so Back skips the finished build.
        replaceNextRef.current = true;
        setScreen(null);
        showModelPage({ jobId }, 'library');
    }, [jobId, showModelPage, dismissJob]);

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

    // Phones: a video picked with Capture's gallery button opens the Video
    // Extractor with it. Shots already taken in Capture would be lost, so it
    // asks first if there are any.
    function openVideosInExtractor(files) {
        confirmLeave(() => {
            handOff('extractor');
            setFrameExtractorDraft({ files });
        });
    }

    // A failed build: back to the Photo Editor or the Video Extractor with its files.
    function retryBuild(build) {
        confirmLeave(() => {
            backgroundBuilds.dismissBuild(build.key);
            if (build.source === 'media') {
                handOff('extractor');
                setFrameExtractorDraft({ files: build.files, ...build.settings });
            } else {
                reviewPhotosInEditor(build.files, build.settings ?? {});
            }
        });
    }

    function showBuildDetails(build) {
        confirmLeave(() => {
            setJobId(build.jobId);
            setScreen('processing');
        });
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

    // The first time an account signs in here: "How do you want to start?",
    // then the welcome card on Home (phones too), which offers the tour.
    const isFirstVisit = Boolean(currentUser) && !hasSeenWalkthrough(currentUser.email);
    const isStartOpen = isFirstVisit && !hasSeenStart(currentUser.email);
    // The walkthrough: on request (Take the tour, Learn, Show walkthrough).
    const isWalkthroughOpen = Boolean(currentUser) && isReplayingWalkthrough;
    const isWelcomeOpen = isFirstVisit && !isStartOpen && !isReplayingWalkthrough && !isNewModelOpen && activeTab === 'home';

    // A choice on "How do you want to start?". Each opens the page it names.
    function answerStart(tab) {
        markStartSeen(currentUser.email);
        setWalkthroughCloseCount((closeCount) => closeCount + 1);
        goToTab(tab);
    }

    // Take the tour, Learn and "Show walkthrough": the walkthrough from step
    // 1, on Home.
    function showWalkthroughAgain() {
        confirmLeave(() => {
            switchTab('home');
            setIsReplayingWalkthrough(true);
        });
    }

    function closeWalkthrough() {
        markWalkthroughSeen(currentUser.email);
        setIsReplayingWalkthrough(false);
        setWalkthroughCloseCount((closeCount) => closeCount + 1);
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
        // Photos or a Video Extractor build, from the build panel (the server's
        // GET /jobs/:id doesn't say which).
        const detailsSource = backgroundBuilds.builds.find((build) => build.jobId === jobId)?.source ?? 'photos';
        return (
            <Processing
                jobId={jobId}
                source={detailsSource}
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
    // Phones: the pink camera button in the middle of the bottom, on the pages
    // JM's mobile Figma shows it on (the others have their own bottom bar).
    const hasCameraButton = isMobile && CAMERA_BUTTON_PAGES.includes(pageTab);
    const isVideoTipOpen = !isMobile && pageTab === 'extractor' && !isWalkthroughOpen
        && !isAccountWindowOpen && !hasSeenTip(VIDEO_TIP.id, currentUser.email);

    return (
        <div className={isMobile
            ? `forma-app genesis-shell has-mobile-topbar${hasCameraButton ? ' has-camera-button' : ''}${pageTab === 'capture' ? ' is-capturing' : ''}`
            : 'forma-app genesis-shell has-app-sidebar'}>
            {/* Phones: the full-screen camera has no top bar, and the model
                page has its own header with a back button instead. */}
            {!(isMobile && (pageTab === 'capture' || pageTab === 'model')) && (
                <TopNav
                    user={currentUser}
                    isCompact={isMobile}
                    // Phones: "Back to home" in place of the logo on other pages, as in the Figma.
                    isBackToHome={isMobile && pageTab !== 'home'}
                    onGoHome={() => goToTab('home')}
                    onOpenModel={openModel}
                    onOpenLibrary={openLibrary}
                    onOpenSettings={() => openAccount('notifications')}
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
                            key={handOffKey}
                            onGenerateModel={handleBatchReady}
                            onUnsavedWorkChange={setHasUnsavedWork}
                            uploadError={uploadError}
                            initialPhotos={photosForEditor}
                            onBackToCapture={returnPhotosToCapture}
                        />
                    )}
                    {pageTab === 'scene' && isMobile && (
                        // Phones: the controls don't fit a small touch screen (JM's mobile Figma has no Scene Builder).
                        <section className="phone-only-note">
                            <h1 className="page-title">Scene Builder</h1>
                            <p>Scene Builder works best on a larger screen. Open Genesis on a computer or tablet to arrange your models.</p>
                            <button type="button" className="forma-btn forma-btn-primary" onClick={() => goToTab('home')}>
                                Back to home
                            </button>
                        </section>
                    )}
                    {pageTab === 'scene' && !isMobile && (
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
                    {pageTab === 'viewer' && (
                        <ModelViewerScreen onOpenModel={openModel} onOpenFile={openLocalModel} />
                    )}
                    {pageTab === 'extractor' && (
                        <FrameExtractor
                            key={handOffKey}
                            onStartBuild={startMediaBuild}
                            onUnsavedWorkChange={setHasUnsavedWork}
                            initialDraft={frameExtractorDraft}
                        />
                    )}
                    {pageTab === 'capture' && (
                        <CameraCapture
                            key={handOffKey}
                            onBatchReady={handleBatchReady}
                            onUnsavedWorkChange={setHasUnsavedWork}
                            onReviewPhotos={reviewPhotosInEditor}
                            onPickVideos={openVideosInExtractor}
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
                            // Phones have no Scene Builder, so no Add to scene.
                            onAddToScene={isMobile ? null : addModelToScene}
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
                    onClose={() => switchTab(accountReturnTab)}
                    onOpenModel={openModel}
                    onOpenLibrary={openLibrary}
                    onSignOut={handleSignOutOrSignIn}
                    onShowWalkthrough={showWalkthroughAgain}
                />
            )}

            {pendingLeave && (
                <ActionDialog
                    title="Discard your photos?"
                    message="The photos or video on this page haven't been made into a model yet. Leaving now throws them away."
                    confirmLabel="Discard and leave"
                    cancelLabel="Stay"
                    danger
                    onConfirm={discardAndLeave}
                    onCancel={() => setPendingLeave(null)}
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
                        // Opening New model already asked about the page's photos.
                        switchTab('capture');
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

            {isStartOpen && (
                <StartScreen
                    onUploadPhotos={() => {
                        answerStart('home');
                        openNewModel();
                    }}
                    onUseVideo={() => answerStart('extractor')}
                    onUseCamera={() => answerStart('capture')}
                    onSkip={() => answerStart('home')}
                />
            )}
            {isWalkthroughOpen && <Walkthrough isGuest={currentUser.isGuest} onClose={closeWalkthrough} />}
            {isWelcomeOpen && <WelcomeCard onTakeTour={showWalkthroughAgain} onExplore={skipWelcome} />}
            {isVideoTipOpen && <TipCard tip={VIDEO_TIP} primaryLabel="Got it" onPrimary={closeVideoTip} />}

            {hasCameraButton && (
                <button type="button" className="phone-camera-button" aria-label="Capture" onClick={() => goToTab('capture')}>
                    <Icon name="camera" size={24} />
                </button>
            )}
        </div>
    );
}

export default App;