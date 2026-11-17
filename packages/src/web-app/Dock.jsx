/*!************************************************************************
\file Dock.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 31-10-2026
\brief
The phone dock: a full-width bar along the bottom of every dashboard page
in the mobile view (760px wide or less; wider screens use the sidebar and
top bar, Sidebar.jsx and TopNav.jsx). Always in view: five tabs at
a time, each an icon with a short label, and an arrow button on the right
that slides to the next five (on the last five it points back and
returns to the first). The tabs can also be swiped. The page containing
the current tab is shown when the page changes.
The tabs: "New model", which opens the camera capture page; the workspace
pages (Home, Media Library, Model Viewer, Photo Editor, Scene Builder,
Video Extractor, Feedback); "Upload", which opens the file picker and
hands the chosen photos to the capture page; and Account, whose menu
links to the account page, mutes / unmutes sound effects, replays the
walkthrough, and signs out (or in, for guests). The avatar shows the
user's profile photo if they set one (ProfilePhoto.js).
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound, setSoundMuted, useSoundSettings } from '../audio/Audio.js';
import { useProfilePhoto } from './ProfilePhoto.js';

const WORKSPACE_ITEMS = [
    { id: 'home', label: 'Home', shortLabel: 'Home', icon: 'home' },
    { id: 'library', label: 'Media Library', shortLabel: 'Library', icon: 'layers' },
    { id: 'editor', label: 'Photo Editor', shortLabel: 'Editor', icon: 'edit' },
    { id: 'scene', label: 'Scene Builder', shortLabel: 'Scene', icon: 'shapes' },
    { id: 'extractor', label: 'Video Extractor', shortLabel: 'Video', icon: 'film' },
    { id: 'viewer', label: 'Model Viewer', shortLabel: 'Viewer', icon: 'cube' },
    { id: 'feedback', label: 'Feedback', shortLabel: 'Feedback', icon: 'message' },
];

// Mobile tab order: the most used first, five per page.
const MOBILE_WORKSPACE_ORDER = ['home', 'library', 'viewer', 'editor', 'scene', 'extractor', 'feedback'];

function Dock({
    activeTab,
    onNavigate,
    onNewModel,
    onAddPhotos,
    user,
    onOpenAccount,
    onShowWalkthrough,
    onSignOut,
}) {
    const fileInputRef = useRef(null);
    const profileRef = useRef(null);
    const mobileScrollerRef = useRef(null);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    // Whether the last tabs are showing, so the arrow points back.
    const [isAtLastMobileTabs, setIsAtLastMobileTabs] = useState(false);
    const { isMuted } = useSoundSettings();
    const profilePhoto = useProfilePhoto(user.email);
    const isCapturePage = activeTab === 'capture';

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

    // Show the five tabs that hold the current page.
    useEffect(() => {
        const scroller = mobileScrollerRef.current;
        const activeItem = scroller?.querySelector('[aria-current="page"]');
        if (!scroller || !activeItem || scroller.clientWidth === 0) return;
        const page = Math.floor(activeItem.offsetLeft / scroller.clientWidth);
        scroller.scrollTo({ left: page * scroller.clientWidth });
    }, [activeTab]);

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

    // aria-labels match the sidebar's, so the walkthrough finds the same items.
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

export default Dock;