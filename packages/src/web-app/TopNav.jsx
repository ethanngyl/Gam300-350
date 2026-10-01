/*!************************************************************************
\file TopNav.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 01-10-2026
\brief
Top navigation bar for the dashboard: renders the Home / Library / Photo
Editor tabs (Scene Builder currently disabled), plays a click sound on
tab change, and shows GPU status and the user avatar.
**************************************************************************/

import { playSound } from '../audio/Audio.js';

const TABS = [
    { id: 'home', label: 'Home' },
    { id: 'library', label: 'Library' },
    { id: 'editor', label: 'Photo Editor' },
    // { id: 'scene', label: 'Scene Builder' },
];

function TopNav({ activeTab, onTabChange }) {
    return (
        <nav className="forma-nav">
            <div className="forma-logo">
                <span className="forma-logo-icon">x</span>
                FORMA 3D
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
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="forma-status">
                <span className="forma-status-dot"></span>
                GPU - Active
            </div>
            <div className="forma-avatar">U</div>
        </nav>
    );
}

export default TopNav;