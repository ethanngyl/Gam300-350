/*!************************************************************************
\file Sidebar.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 27-10-2026
\brief
Left sidebar shown on every dashboard page, laid out like the Genesis
wireframe. From top to bottom: a collapse button; "New model", which opens
the camera capture page; "Add photos", which opens the file picker and
hands the chosen photos to the capture page; the workspace pages (Home,
Media Library, Photo Editor, Scene Builder, Video Extractor, Model
Viewer); and the signed-in user at the bottom, whose menu links to the
account page, mutes / unmutes sound effects, and signs out (or in, for
guests). The item for the current
page is highlighted. Collapsed (wider screens), only icons show. On phones
it becomes a slide-in drawer: isOpen shows it, and every item calls
onClose so the drawer shuts after a choice is made.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound, setSoundMuted, useSoundSettings } from '../audio/Audio.js';

const WORKSPACE_ITEMS = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'library', label: 'Media Library', icon: 'layers' },
    { id: 'editor', label: 'Photo Editor', icon: 'edit' },
    { id: 'scene', label: 'Scene Builder', icon: 'shield' },
    { id: 'youtube', label: 'Video Extractor', icon: 'play' },
    { id: 'viewer', label: 'Model Viewer', icon: 'cube' },
];

function Sidebar({
    activeTab,
    onNavigate,
    onNewModel,
    onAddPhotos,
    user,
    onOpenAccount,
    onSignOut,
    isCollapsed,
    onToggleCollapsed,
    isOpen,
    onClose,
}) {
    const fileInputRef = useRef(null);
    const profileRef = useRef(null);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const { isMuted } = useSoundSettings();
    const isCapturePage = activeTab === 'capture';

    // Close the profile menu when the user clicks anywhere outside it.
    useEffect(() => {
        if (!isProfileMenuOpen) return;

        function closeWhenClickingOutside(event) {
            if (profileRef.current && !profileRef.current.contains(event.target)) {
                setIsProfileMenuOpen(false);
            }
        }

        document.addEventListener('mousedown', closeWhenClickingOutside);
        return () => document.removeEventListener('mousedown', closeWhenClickingOutside);
    }, [isProfileMenuOpen]);

    function handleFilesChosen(event) {
        const chosenFiles = Array.from(event.target.files ?? []);
        // Clear so choosing the same files again still fires onChange.
        event.target.value = '';
        if (chosenFiles.length === 0) return;
        onClose();
        onAddPhotos(chosenFiles);
    }

    const sidebarClassName = [
        'genesis-sidebar',
        isOpen ? 'is-open' : '',
        isCollapsed ? 'is-collapsed' : '',
    ].join(' ').trim();

    return (
        <aside className={sidebarClassName}>
            <button
                className="genesis-collapse-btn"
                onClick={() => {
                    playSound('tap');
                    setIsProfileMenuOpen(false);
                    onToggleCollapsed();
                }}
                aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
                <Icon name="chevron" size={15} />
            </button>

            <button
                className={
                    isCapturePage
                        ? 'forma-btn forma-btn-primary genesis-new-model is-active'
                        : 'forma-btn forma-btn-primary genesis-new-model'
                }
                onClick={() => {
                    playSound('tap');
                    onClose();
                    onNewModel();
                }}
                title="New model"
            >
                <Icon name="camera" size={16} /> <span>New model</span>
            </button>

            <button
                className="forma-btn genesis-add-photos"
                onClick={() => {
                    playSound('tap');
                    fileInputRef.current?.click();
                }}
                title="Add photos"
            >
                <Icon name="upload" size={16} /> <span>Add photos</span>
            </button>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFilesChosen}
                style={{ display: 'none' }}
            />

            <div className="genesis-side-label">Workspace</div>
            {WORKSPACE_ITEMS.map((item) => (
                <button
                    key={item.id}
                    className={activeTab === item.id ? 'genesis-side-item is-active' : 'genesis-side-item'}
                    onClick={() => {
                        playSound('tap');
                        onClose();
                        onNavigate(item.id);
                    }}
                    title={item.label}
                >
                    <Icon name={item.icon} size={16} /> <span>{item.label}</span>
                </button>
            ))}

            <div className="genesis-profile" ref={profileRef}>
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
                                            setIsProfileMenuOpen(false);
                                            onClose();
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
                                setIsProfileMenuOpen(false);
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
                    className={activeTab === 'account' ? 'genesis-profile-btn is-active' : 'genesis-profile-btn'}
                    onClick={() => {
                        playSound('tap');
                        setIsProfileMenuOpen((wasOpen) => !wasOpen);
                    }}
                    aria-expanded={isProfileMenuOpen}
                    aria-label="Open account menu"
                    title={user.name}
                >
                    <span className="forma-avatar genesis-profile-avatar"><Icon name="user" size={15} /></span>
                    <span className="genesis-profile-text">
                        <span className="genesis-profile-name">{user.name}</span>
                        <span className="genesis-profile-email">{user.email}</span>
                    </span>
                    <Icon name="chevron" size={13} />
                </button>
            </div>
        </aside>
    );
}

export default Sidebar;