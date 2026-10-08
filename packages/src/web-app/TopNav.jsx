/*!************************************************************************
\file TopNav.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Top navigation bar: GENESIS logo, Home / Library / Photo Editor / Scene
Builder tabs (with click sound), a workspace status indicator, and the
signed-in user's avatar. Clicking the avatar opens a small account menu
with links to the account page and sign out.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

const TABS = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'library', label: 'Library', icon: 'layers' },
    { id: 'editor', label: 'Photo Editor', icon: 'edit' },
    { id: 'scene', label: 'Scene Builder', icon: 'shield' }, // comment out this line to disable the tab
];

function TopNav({ activeTab, onTabChange, user, onOpenAccount, onSignOut }) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const menuContainerRef = useRef(null);

    // Close the account menu when the user clicks anywhere outside it.
    useEffect(() => {
        if (!isMenuOpen) return;

        function closeWhenClickingOutside(event) {
            if (menuContainerRef.current && !menuContainerRef.current.contains(event.target)) {
                setIsMenuOpen(false);
            }
        }

        document.addEventListener('mousedown', closeWhenClickingOutside);
        return () => document.removeEventListener('mousedown', closeWhenClickingOutside);
    }, [isMenuOpen]);

    return (
        <nav className="forma-nav">
            <div className="forma-logo">
                <span className="forma-logo-icon"><Icon name="cube" size={18} /></span>
                GENESIS
            </div>

            <div className="forma-tabs">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        className={activeTab === tab.id ? 'forma-tab is-active' : 'forma-tab'}
                        onClick={() => {
                            playSound('click');
                            onTabChange(tab.id);
                        }}
                    >
                        <Icon name={tab.icon} size={14} />
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            <div className="forma-status">
                <span className="forma-status-dot"></span>
                Workspace ready
            </div>

            <div className="forma-account" ref={menuContainerRef}>
                <button
                    className="forma-avatar"
                    onClick={() => {
                        playSound('click');
                        setIsMenuOpen((wasOpen) => !wasOpen);
                    }}
                    aria-label="Open account menu"
                >
                    {user.name.charAt(0).toUpperCase()}
                </button>

                {isMenuOpen && (
                    <div className="forma-account-menu">
                        <div className="forma-account-menu-name">{user.name}</div>
                        <div className="forma-account-menu-email">{user.email}</div>
                        <button
                            className="forma-account-menu-item"
                            onClick={() => {
                                playSound('click');
                                setIsMenuOpen(false);
                                onOpenAccount();
                            }}
                        >
                            <Icon name="user" size={14} /> My account
                        </button>
                        <button
                            className="forma-account-menu-item"
                            onClick={() => {
                                playSound('click3');
                                setIsMenuOpen(false);
                                onSignOut();
                            }}
                        >
                            <Icon name="logout" size={14} /> Sign out
                        </button>
                    </div>
                )}
            </div>
        </nav>
    );
}

export default TopNav;