/*!************************************************************************
\file Dock.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 31-10-2026
\brief
Floating dock at the bottom of every dashboard page (Genesis "second
layout"), replacing the top nav and sidebar. Left to right: "New model",
which opens the camera capture page; "Add photos", which opens the file
picker and hands the chosen photos to the capture page; the workspace
pages (Home, Media Library, Photo Editor, Scene Builder, Frame
Extractor, Model Viewer, Feedback); and the signed-in user, whose menu opens upwards
and links to the account page, mutes / unmutes sound effects, replays
the walkthrough, and signs out (or in, for guests). The avatar shows the user's profile photo if
they set one on the account page (ProfilePhoto.js). Each item is an icon whose label slides out on
hover or keyboard focus; the current page is highlighted. A switch in its
own panel at the top-right corner ("Show Tab Labels" / "Hide Tab Labels")
keeps every label showing instead, in one straight row (remembered on this
browser). It only shows where that row fits, from 1160px wide; narrower
windows keep the icons-only dock.
On devices with a mouse, the dock fades and slides mostly out of view 3s
after the pointer leaves it, and comes back when the pointer reaches the
bottom of the screen or the dock gets keyboard focus. isPinned (set during
the walkthrough) also keeps the dock in view.
In the mobile view (760px wide or less) it is a full-width bar instead,
always in view: five tabs at a time, each an icon with a short label, and
an arrow button on the right that slides to the next five (on the last
five it points back and returns to the first). The tabs can also be
swiped. The page containing the current tab is shown when the page changes.
**************************************************************************/

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Icon from './Icons.jsx';
import { playSound, setSoundMuted, useSoundSettings } from '../audio/Audio.js';
import { useProfilePhoto } from './ProfilePhoto.js';

const WORKSPACE_ITEMS = [
    { id: 'home', label: 'Home', shortLabel: 'Home', icon: 'home' },
    { id: 'library', label: 'Media Library', shortLabel: 'Library', icon: 'layers' },
    { id: 'editor', label: 'Photo Editor', shortLabel: 'Editor', icon: 'edit' },
    { id: 'scene', label: 'Scene Builder', shortLabel: 'Scene', icon: 'shapes' },
    { id: 'extractor', label: 'Frame Extractor', shortLabel: 'Frames', icon: 'play' },
    { id: 'viewer', label: 'Model Viewer', shortLabel: 'Viewer', icon: 'cube' },
    { id: 'feedback', label: 'Feedback', shortLabel: 'Feedback', icon: 'message' },
];

// Mobile tab order: the most used first, five per page.
const MOBILE_WORKSPACE_ORDER = ['home', 'library', 'viewer', 'editor', 'scene', 'extractor', 'feedback'];

// How long the dock waits after the pointer leaves before it fades.
const IDLE_DELAY_MS = 3000;

// Remembers "Show tab labels" on this browser.
const SHOW_LABELS_KEY = 'genesis-dock-show-labels';

// Storage can be blocked (private windows, site data off), so every access is wrapped.
function loadShowLabels() {
    try {
        return window.localStorage.getItem(SHOW_LABELS_KEY) === 'true';
    } catch {
        return false;
    }
}

function saveShowLabels(showLabels) {
    try {
        window.localStorage.setItem(SHOW_LABELS_KEY, String(showLabels));
    } catch {
        // Storage unavailable: the choice lasts until the page is reloaded.
    }
}

// Only the desktop view fades the dock: it needs a mouse to bring the dock
// back, and the mobile view keeps it in view at all times.
function canFadeDock() {
    return window.matchMedia?.('(hover: hover) and (pointer: fine) and (min-width: 761px)').matches ?? false;
}

// Same width as the mobile view in AppTheme.css.
const MOBILE_QUERY = '(max-width: 760px)';

function subscribeToMobileView(onChange) {
    const query = window.matchMedia?.(MOBILE_QUERY);
    query?.addEventListener('change', onChange);
    return () => query?.removeEventListener('change', onChange);
}

function isMobileView() {
    return window.matchMedia?.(MOBILE_QUERY).matches ?? false;
}

function Dock({
    activeTab,
    onNavigate,
    onNewModel,
    onAddPhotos,
    user,
    onOpenAccount,
    onShowWalkthrough,
    onSignOut,
    isPinned = false,
}) {
    const fileInputRef = useRef(null);
    const profileRef = useRef(null);
    const idleTimerRef = useRef(null);
    const mobileScrollerRef = useRef(null);
    const labelsToggleRef = useRef(null);
    // Whether the last press on the tab labels switch was a finger (touch screens can't hover).
    const wasLabelsTogglePressedByTouchRef = useRef(false);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const [isIdle, setIsIdle] = useState(false);
    // Every item shows its full label, not just the icon (desktop view only).
    const [showLabels, setShowLabels] = useState(loadShowLabels);
    // Touch screens: the tab labels switch was tapped open (a mouse opens it by hovering).
    const [isLabelsToggleOpen, setIsLabelsToggleOpen] = useState(false);
    // Mobile view: whether the last tabs are showing, so the arrow points back.
    const [isAtLastMobileTabs, setIsAtLastMobileTabs] = useState(false);
    const isMobile = useSyncExternalStore(subscribeToMobileView, isMobileView);
    // The view the dock last rendered, to notice switching between mobile and desktop.
    const [lastRenderedIsMobile, setLastRenderedIsMobile] = useState(isMobile);
    const { isMuted } = useSoundSettings();
    const profilePhoto = useProfilePhoto(user.email);
    const isCapturePage = activeTab === 'capture';

    // Switched between mobile and desktop (window resized): the mobile tabs
    // start again from the first five, so the arrow points forward again,
    // and the profile menu closes (it sits somewhere else in the other view).
    if (lastRenderedIsMobile !== isMobile) {
        setLastRenderedIsMobile(isMobile);
        setIsAtLastMobileTabs(false);
        setIsProfileMenuOpen(false);
    }

    const clearIdleTimer = useCallback(() => {
        if (idleTimerRef.current !== null) {
            window.clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
    }, []);

    function showDock() {
        clearIdleTimer();
        setIsIdle(false);
    }

    // Starts the countdown to fade the dock (not while its menu is open).
    function scheduleIdle() {
        clearIdleTimer();
        if (isProfileMenuOpen || isPinned || !canFadeDock()) return;
        idleTimerRef.current = window.setTimeout(() => setIsIdle(true), IDLE_DELAY_MS);
    }

    // Stop any pending fade when the dock goes away (e.g. on sign out).
    useEffect(() => clearIdleTimer, [clearIdleTimer]);

    // Close the profile menu on a click outside it or on Escape.
    useEffect(() => {
        if (!isProfileMenuOpen) return;

        function closeWhenClickingOutside(event) {
            if (profileRef.current && !profileRef.current.contains(event.target)) {
                setIsProfileMenuOpen(false);
            }
        }

        function closeOnEscape(event) {
            if (event.key === 'Escape') setIsProfileMenuOpen(false);
        }

        document.addEventListener('mousedown', closeWhenClickingOutside);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('mousedown', closeWhenClickingOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isProfileMenuOpen]);

    // Touch screens: close the tab labels switch on a tap anywhere else.
    useEffect(() => {
        if (!isLabelsToggleOpen) return;

        function closeWhenTappingOutside(event) {
            if (!labelsToggleRef.current?.contains(event.target)) setIsLabelsToggleOpen(false);
        }

        document.addEventListener('pointerdown', closeWhenTappingOutside);
        return () => document.removeEventListener('pointerdown', closeWhenTappingOutside);
    }, [isLabelsToggleOpen]);

    // Mobile view: show the five tabs that hold the current page.
    useEffect(() => {
        if (!isMobile) return;
        const scroller = mobileScrollerRef.current;
        const activeItem = scroller?.querySelector('[aria-current="page"]');
        if (!scroller || !activeItem || scroller.clientWidth === 0) return;
        const page = Math.floor(activeItem.offsetLeft / scroller.clientWidth);
        scroller.scrollTo({ left: page * scroller.clientWidth });
    }, [activeTab, isMobile]);

    function handleFilesChosen(event) {
        const chosenFiles = Array.from(event.target.files ?? []);
        // Clear so choosing the same files again still fires onChange.
        event.target.value = '';
        if (chosenFiles.length === 0) return;
        onAddPhotos(chosenFiles);
    }

    function closeProfileMenu() {
        setIsProfileMenuOpen(false);
    }

    function openFilePicker() {
        fileInputRef.current?.click();
    }

    // Mobile view: a tab was tapped ('capture', 'add', or a workspace page id).
    function selectMobileItem(key) {
        if (key === 'capture') onNewModel();
        else if (key === 'add') openFilePicker();
        else onNavigate(key);
    }

    function handleLabelsToggleClick() {
        // Touch screens: the first tap only opens it, so the user can see what it does.
        if (wasLabelsTogglePressedByTouchRef.current && !isLabelsToggleOpen) {
            playSound('tap');
            setIsLabelsToggleOpen(true);
            return;
        }
        toggleShowLabels();
    }

    function toggleShowLabels() {
        playSound('tap');
        saveShowLabels(!showLabels);
        setShowLabels(!showLabels);
    }

    // Mobile view: notes whether the tabs have reached the last page.
    function handleMobileScroll(event) {
        const scroller = event.currentTarget;
        setIsAtLastMobileTabs(scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4);
    }

    // Mobile view: the arrow slides to the next five tabs, or back to the first.
    function showNextMobileTabs() {
        playSound('tap');
        closeProfileMenu();
        const scroller = mobileScrollerRef.current;
        if (!scroller) return;
        if (isAtLastMobileTabs) scroller.scrollTo({ left: 0, behavior: 'smooth' });
        else scroller.scrollBy({ left: scroller.clientWidth, behavior: 'smooth' });
    }

    const fileInput = (
        <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFilesChosen}
            style={{ display: 'none' }}
        />
    );

    const profileMenu = isProfileMenuOpen && (
        <div className="genesis-profile-menu" role="dialog" aria-label="Account overview">
            <div className="genesis-profile-summary">
                <span className="forma-avatar genesis-profile-avatar-large">
                    {profilePhoto ? <img src={profilePhoto} alt="" /> : <Icon name="user" size={22} />}
                </span>
                <div className="genesis-profile-identity">
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                    {!user.isGuest && (
                        <button
                            className="genesis-profile-link"
                            onClick={() => {
                                playSound('tap');
                                closeProfileMenu();
                                onOpenAccount();
                            }}
                        >
                            Manage account
                        </button>
                    )}
                </div>
            </div>
            <div className="genesis-profile-divider" />
            <button
                className="forma-account-menu-item"
                onClick={() => {
                    setSoundMuted(!isMuted);
                    // Muting stays silent; unmuting plays once to confirm.
                    if (isMuted) playSound('tap');
                }}
            >
                <Icon name={isMuted ? 'volume' : 'volumeOff'} size={14} />
                {isMuted ? ' Unmute sounds' : ' Mute sounds'}
            </button>
            <button
                className="forma-account-menu-item"
                onClick={() => {
                    playSound('tap');
                    closeProfileMenu();
                    onShowWalkthrough();
                }}
            >
                <Icon name="refresh" size={14} /> Show walkthrough
            </button>
            <button
                className="forma-account-menu-item"
                onClick={() => {
                    playSound('back');
                    closeProfileMenu();
                    onSignOut();
                }}
            >
                {user.isGuest
                    ? <><Icon name="user" size={14} /> Sign in</>
                    : <><Icon name="logout" size={14} /> Sign out</>}
            </button>
        </div>
    );

    if (isMobile) {
        // aria-labels match the desktop dock's, so the walkthrough finds the same items.
        const mobileItems = [
            { key: 'capture', label: 'New model', shortLabel: 'New', icon: 'cubePlus', isActive: isCapturePage, isPrimary: true },
            ...MOBILE_WORKSPACE_ORDER.map((id) => {
                const item = WORKSPACE_ITEMS.find((workspaceItem) => workspaceItem.id === id);
                return { key: id, label: item.label, shortLabel: item.shortLabel, icon: item.icon, isActive: activeTab === id };
            }),
            { key: 'add', label: 'Add photos', shortLabel: 'Upload', icon: 'upload' },
        ];

        return (
            <nav className="genesis-dock genesis-dock-mobile" aria-label="Workspace" ref={profileRef}>
                {profileMenu}
                <div className="genesis-mdock-scroller" ref={mobileScrollerRef} onScroll={handleMobileScroll}>
                    {mobileItems.map((item) => (
                        <button
                            key={item.key}
                            className={[
                                'genesis-mdock-item',
                                item.isPrimary && 'is-primary',
                                item.isActive && 'is-active',
                            ].filter(Boolean).join(' ')}
                            onClick={() => {
                                playSound('tap');
                                closeProfileMenu();
                                selectMobileItem(item.key);
                            }}
                            aria-label={item.label}
                            aria-current={item.isActive ? 'page' : undefined}
                        >
                            <span className="genesis-mdock-icon"><Icon name={item.icon} size={18} /></span>
                            <span className="genesis-mdock-label">{item.shortLabel}</span>
                        </button>
                    ))}
                    <button
                        className={activeTab === 'account' ? 'genesis-mdock-item genesis-dock-avatar is-active' : 'genesis-mdock-item genesis-dock-avatar'}
                        onClick={() => {
                            playSound('tap');
                            setIsProfileMenuOpen((wasOpen) => !wasOpen);
                        }}
                        aria-expanded={isProfileMenuOpen}
                        aria-label={`${user.name}, account menu`}
                        aria-current={activeTab === 'account' ? 'page' : undefined}
                    >
                        <span className="forma-avatar genesis-mdock-icon genesis-mdock-avatar-icon">
                            {profilePhoto ? <img src={profilePhoto} alt="" /> : <Icon name="user" size={15} />}
                        </span>
                        <span className="genesis-mdock-label">Account</span>
                    </button>
                </div>
                <button
                    className={isAtLastMobileTabs ? 'genesis-mdock-arrow is-back' : 'genesis-mdock-arrow'}
                    onClick={showNextMobileTabs}
                    aria-label={isAtLastMobileTabs ? 'Show first tabs' : 'Show more tabs'}
                >
                    <Icon name="arrow" size={18} />
                </button>
                {fileInput}
            </nav>
        );
    }

    const dockClassName = [
        'genesis-dock',
        isIdle && !isPinned && 'is-idle',
        showLabels && 'is-labelled',
    ].filter(Boolean).join(' ');

    return (
        <>
            {/* Invisible strip along the bottom edge: reaching it brings a faded dock back. */}
            <div className="genesis-dock-reveal" onPointerEnter={showDock} aria-hidden="true" />

            <nav
                className={dockClassName}
                aria-label="Workspace"
                onPointerEnter={showDock}
                onPointerLeave={scheduleIdle}
                onFocus={showDock}
                onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) scheduleIdle();
                }}
            >
                <div className="genesis-dock-group">
                    <button
                        className={isCapturePage ? 'genesis-dock-item is-primary is-active' : 'genesis-dock-item is-primary'}
                        onClick={() => {
                            playSound('tap');
                            closeProfileMenu();
                            onNewModel();
                        }}
                        aria-label="New model"
                        aria-current={isCapturePage ? 'page' : undefined}
                    >
                        <Icon name="cubePlus" size={17} />
                        <span className="genesis-dock-label">New model</span>
                    </button>
                    <button
                        className="genesis-dock-item"
                        onClick={() => {
                            playSound('tap');
                            closeProfileMenu();
                            openFilePicker();
                        }}
                        aria-label="Add photos"
                    >
                        <Icon name="upload" size={17} />
                        <span className="genesis-dock-label">Add photos</span>
                    </button>
                    {fileInput}
                </div>

                <span className="genesis-dock-divider" aria-hidden="true" />

                <div className="genesis-dock-group">
                    {WORKSPACE_ITEMS.map((item) => (
                        <button
                            key={item.id}
                            className={activeTab === item.id ? 'genesis-dock-item is-active' : 'genesis-dock-item'}
                            onClick={() => {
                                playSound('tap');
                                closeProfileMenu();
                                onNavigate(item.id);
                            }}
                            aria-label={item.label}
                            aria-current={activeTab === item.id ? 'page' : undefined}
                        >
                            <Icon name={item.icon} size={17} />
                            <span className="genesis-dock-label">{item.label}</span>
                        </button>
                    ))}
                </div>

                <span className="genesis-dock-divider" aria-hidden="true" />

                <div className="genesis-dock-profile" ref={profileRef}>
                    {profileMenu}

                    <button
                        className={activeTab === 'account' ? 'genesis-dock-item genesis-dock-avatar is-active' : 'genesis-dock-item genesis-dock-avatar'}
                        onClick={() => {
                            playSound('tap');
                            setIsProfileMenuOpen((wasOpen) => !wasOpen);
                        }}
                        aria-expanded={isProfileMenuOpen}
                        aria-label={`${user.name}, account menu`}
                    >
                        <span className="forma-avatar genesis-dock-avatar-icon">
                            {profilePhoto ? <img src={profilePhoto} alt="" /> : <Icon name="user" size={15} />}
                        </span>
                        <span className="genesis-dock-label">{user.name}</span>
                    </button>
                </div>
            </nav>

            {/* Its own small panel in the top-right corner, apart from the dock. */}
            <button
                ref={labelsToggleRef}
                type="button"
                className={[
                    'genesis-labels-toggle',
                    showLabels && 'is-on',
                    isLabelsToggleOpen && 'is-open',
                ].filter(Boolean).join(' ')}
                onPointerDown={(event) => {
                    wasLabelsTogglePressedByTouchRef.current = event.pointerType === 'touch';
                }}
                onClick={handleLabelsToggleClick}
                role="switch"
                aria-checked={showLabels}
                aria-label="Show tab labels"
                title={showLabels ? 'Hide tab labels' : 'Show tab labels'}
            >
                <Icon name="menu" size={15} />
                <span className="genesis-labels-toggle-text" aria-hidden="true">
                    {showLabels ? 'Hide Tab Labels' : 'Show Tab Labels'}
                </span>
                <span className="genesis-labels-toggle-track" aria-hidden="true">
                    <span className="genesis-labels-toggle-thumb" />
                </span>
                {showLabels && <span className="genesis-labels-toggle-dot" aria-hidden="true" />}
            </button>
        </>
    );
}

export default Dock;