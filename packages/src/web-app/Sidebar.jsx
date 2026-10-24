/*!************************************************************************
\file Sidebar.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Left sidebar, the main navigation (theme 2: there is no top nav on
desktop). From top to bottom: GENESIS logo and a collapse button; "New
model", which opens the camera capture page; "Add photos", which opens
the file picker and hands the chosen photos to the capture page; the
pages (Home, Media Library, Photo Editor, Scene Builder, YouTube
Extractor, Model Viewer); and the signed-in user at the bottom, whose
menu links to the account page and signs out (or in, for guests).
The item for the current page is highlighted. Collapsed, only icons show.
On phones it becomes a slide-in drawer: isOpen shows it, and every item
calls onClose so the drawer shuts after a choice is made.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

const PAGE_ITEMS = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'library', label: 'Media Library', icon: 'layers' },
    { id: 'editor', label: 'Photo Editor', icon: 'edit' },
    { id: 'scene', label: 'Scene Builder', icon: 'shield' },
    { id: 'youtube', label: 'YouTube Extractor', icon: 'play' },
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
    ].join(' ');

    return (
        <aside className={sidebarClassName}>
            <div className="genesis-side-top">
                <div className="forma-logo genesis-side-logo">
                    <span className="forma-logo-icon"><Icon name="cube" size={18} /></span>
                    <span className="forma-logo-text">GENESIS</span>
                </div>
                <button
                    className="genesis-collapse-btn"
                    onClick={() => {
                        playSound('click');
                        onToggleCollapsed();
                    }}
                    aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    <Icon name="chevron" size={14} />
                </button>
            </div>

            <button
                className={
                    activeTab === 'capture'
                        ? 'forma-btn forma-btn-primary genesis-new-model is-active'
                        : 'forma-btn forma-btn-primary genesis-new-model'
                }
                onClick={() => {
                    playSound('click');
                    onClose();
                    onNewModel();
                }}
                title="New model"
            >
                <Icon name="camera" size={15} /> <span>New model</span>
            </button>

            <button
                className="forma-btn genesis-add-photos"
                onClick={() => {
                    playSound('click');
                    fileInputRef.current?.click();
                }}
                title="Add photos"
            >
                <Icon name="image" size={15} /> <span>Add photos</span>
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
            {PAGE_ITEMS.map((item) => (
                <button
                    key={item.id}
                    className={activeTab === item.id ? 'genesis-side-item is-active' : 'genesis-side-item'}
                    onClick={() => {
                        playSound('click');
                        onClose();
                        onNavigate(item.id);
                    }}
                    title={item.label}
                >
                    <Icon name={item.icon} size={15} /> <span>{item.label}</span>
                </button>
            ))}

            <div className="genesis-profile" ref={profileRef}>
                {isProfileMenuOpen && (
                    <div className="genesis-profile-menu">
                        <div className="forma-account-menu-name">{user.name}</div>
                        <div className="forma-account-menu-email">{user.email}</div>
                        <button
                            className="forma-account-menu-item"
                            onClick={() => {
                                playSound('click');
                                setIsProfileMenuOpen(false);
                                onClose();
                                onOpenAccount();
                            }}
                        >
                            <Icon name="user" size={14} /> My account
                        </button>
                        <button
                            className="forma-account-menu-item"
                            onClick={() => {
                                playSound('click3');
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
                        playSound('click');
                        setIsProfileMenuOpen((wasOpen) => !wasOpen);
                    }}
                    aria-label="Open account menu"
                    title={user.name}
                >
                    <span className="forma-avatar">{user.name.charAt(0).toUpperCase()}</span>
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