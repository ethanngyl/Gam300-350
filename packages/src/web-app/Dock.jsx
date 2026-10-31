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
pages (Home, Media Library, Photo Editor, Scene Builder, YouTube
Extractor, Model Viewer); and the signed-in user, whose menu opens upwards
and links to the account page, mutes / unmutes sound effects, and signs
out (or in, for guests). Each item is an icon whose label slides out on
hover or keyboard focus; the current page is highlighted.
On devices with a mouse, the dock fades and slides mostly out of view 3s
after the pointer leaves it, and comes back when the pointer reaches the
bottom of the screen or the dock gets keyboard focus. In the mobile view
(760px wide or less, or any touch screen) the dock always stays in view
and shows icons only, to save space.
**************************************************************************/

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound, setSoundMuted, useSoundSettings } from '../audio/Audio.js';

const WORKSPACE_ITEMS = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'library', label: 'Media Library', icon: 'layers' },
    { id: 'editor', label: 'Photo Editor', icon: 'edit' },
    { id: 'scene', label: 'Scene Builder', icon: 'shield' },
    { id: 'youtube', label: 'YouTube Extractor', icon: 'play' },
    { id: 'viewer', label: 'Model Viewer', icon: 'cube' },
];

// How long the dock waits after the pointer leaves before it fades.
const IDLE_DELAY_MS = 3000;

// Only the desktop view fades the dock: it needs a mouse to bring the dock
// back, and the mobile view keeps it in view at all times.
function canFadeDock() {
    return window.matchMedia?.('(hover: hover) and (pointer: fine) and (min-width: 761px)').matches ?? false;
}

function Dock({ activeTab, onNavigate, onNewModel, onAddPhotos, user, onOpenAccount, onSignOut }) {
    const fileInputRef = useRef(null);
    const profileRef = useRef(null);
    const idleTimerRef = useRef(null);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const [isIdle, setIsIdle] = useState(false);
    const { isMuted } = useSoundSettings();
    const isCapturePage = activeTab === 'capture';

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
        if (isProfileMenuOpen || !canFadeDock()) return;
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

    const dockClassName = isIdle ? 'genesis-dock is-idle' : 'genesis-dock';

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
                        <Icon name="camera" size={17} />
                        <span className="genesis-dock-label">New model</span>
                    </button>
                    <button
                        className="genesis-dock-item"
                        onClick={() => {
                            playSound('tap');
                            closeProfileMenu();
                            fileInputRef.current?.click();
                        }}
                        aria-label="Add photos"
                    >
                        <Icon name="upload" size={17} />
                        <span className="genesis-dock-label">Add photos</span>
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleFilesChosen}
                        style={{ display: 'none' }}
                    />
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
                    {isProfileMenuOpen && (
                        <div className="genesis-profile-menu" role="dialog" aria-label="Account overview">
                            <div className="genesis-profile-summary">
                                <span className="forma-avatar genesis-profile-avatar-large">
                                    <Icon name="user" size={22} />
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
                    )}

                    <button
                        className={activeTab === 'account' ? 'genesis-dock-item genesis-dock-avatar is-active' : 'genesis-dock-item genesis-dock-avatar'}
                        onClick={() => {
                            playSound('tap');
                            setIsProfileMenuOpen((wasOpen) => !wasOpen);
                        }}
                        aria-expanded={isProfileMenuOpen}
                        aria-label={`${user.name}, account menu`}
                    >
                        <span className="forma-avatar genesis-dock-avatar-icon"><Icon name="user" size={15} /></span>
                        <span className="genesis-dock-label">{user.name}</span>
                    </button>
                </div>
            </nav>
        </>
    );
}

export default Dock;