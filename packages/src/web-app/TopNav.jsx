/*!************************************************************************
\file TopNav.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
Phone-only header (theme 2): a menu button that opens the sidebar drawer
and the GENESIS logo. On wider screens it is hidden by CSS, because the
sidebar holds the logo, every page and the account menu.
**************************************************************************/

import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

function TopNav({ onToggleMenu }) {
    return (
        <nav className="forma-nav">
            <button
                className="forma-menu-btn"
                onClick={() => {
                    playSound('click');
                    onToggleMenu();
                }}
                aria-label="Open menu"
            >
                <Icon name="menu" size={20} />
            </button>

            <div className="forma-logo">
                <span className="forma-logo-icon"><Icon name="cube" size={18} /></span>
                <span className="forma-logo-text">GENESIS</span>
            </div>
        </nav>
    );
}

export default TopNav;