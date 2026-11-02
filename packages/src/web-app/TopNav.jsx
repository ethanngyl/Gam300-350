/*!************************************************************************
\file TopNav.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 09-10-2026
\brief
Top navigation bar: a menu button (phones only) that opens the sidebar
drawer, the GENESIS logo (click it to go to Home), Library / Photo Editor /
Scene Builder / Video Extractor tabs (with click sound), and the signed-in user's
avatar. (The "Workspace ready" indicator was removed.) Clicking the avatar opens a small account menu with links
to the account page, a quick mute / unmute for sound effects, and sign
out.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import genesisLogo from './GenesisLogo.svg';
import { playSound, setSoundMuted, useSoundSettings } from '../audio/Audio.js';

const TABS = [
    { id: 'library', label: 'Library', icon: 'layers' },
    { id: 'editor', label: 'Photo Editor', icon: 'edit' },
    { id: 'scene', label: 'Scene Builder', icon: 'shield' },
    { id: 'youtube', label: 'Video Extractor', icon: 'play' },
];

function TopNav({ activeTab, onTabChange, user, onOpenAccount, onSignOut, onToggleMenu }) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const menuContainerRef = useRef(null);
    const { isMuted } = useSoundSettings();

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
            {/* Only visible on phones, where the sidebar becomes a drawer. */}
            <button
                className="forma-menu-btn"
                onClick={() => {
                    playSound('tap');
                    onToggleMenu();
                }}
                aria-label="Open menu"
            >
                <Icon name="menu" size={20} />
            </button>

            {/* The logo is the way back to Home (Home also stays in the sidebar). */}
            <button
                className="forma-logo forma-logo-home"
                onClick={() => {
                    playSound('tap');
                    onTabChange('home');
                }}
                aria-label="Go to Home"
                title="Home"
            >
                <span className="forma-logo-icon"><img src={genesisLogo} alt="" /></span>
                <span className="forma-logo-text">GENESIS</span>
            </button>

            <div className="forma-tabs">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        className={activeTab === tab.id
                            ? 'forma-tab is-active'
                            : 'forma-tab'}
                        onClick={() => {
                            playSound('tap');
                            onTabChange(tab.id);
                        }}
                        aria-label={tab.label}
                    >
                        <Icon name={tab.icon} size={14} />
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            <div className="forma-account" ref={menuContainerRef}>
                <button
                    className="forma-avatar"
                    onClick={() => {
                        playSound('tap');
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
                                playSound('tap');
                                setIsMenuOpen(false);
                                onOpenAccount();
                            }}
                        >
                            <Icon name="user" size={14} /> My account
                        </button>
                        <button
                            className="forma-account-menu-item"
                            onClick={() => {
                                setSoundMuted(!isMuted);
                                // Muting stays silent; unmuting plays once to confirm.
                                if (isMuted) playSound('tap');
                                setIsMenuOpen(false);
                            }}
                        >
                            <Icon name={isMuted ? 'volume' : 'volumeOff'} size={14} />
                            {isMuted ? ' Unmute sounds' : ' Mute sounds'}
                        </button>
                        <button
                            className="forma-account-menu-item"
                            onClick={() => {
                                playSound('back');
                                setIsMenuOpen(false);
                                onSignOut();
                            }}
                        >
                            {user.isGuest
                                ? <><Icon name="user" size={14} /> Sign in</>
                                : <><Icon name="logout" size={14} /> Sign out</>}
                        </button>
                    </div>
                )}
            </div>
        </nav>
    );
}

export default TopNav;