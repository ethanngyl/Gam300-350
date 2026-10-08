/*!************************************************************************
\file AccountScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Account page for the signed-in user: profile card (avatar, name, email,
member since), a sign out button, and the workspace usage stats that used
to sit on the Home screen (still static placeholder numbers).
**************************************************************************/

import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

const STATS = [
    { value: '24', label: 'Models Generated', note: '+3 this week' },
    { value: '156', label: 'Photos Uploaded', note: '+18 this week' },
    { value: '3', label: 'Active Scenes', note: 'Last edited today' },
    { value: '2', label: 'Processing Queue', note: 'Est. 4 min' },
];

function AccountScreen({ user, onSignOut }) {
    return (
        <div className="account-screen">
            <p className="eyebrow">Account</p>
            <h1>Your account</h1>

            <div className="forma-card account-profile">
                <div className="account-avatar">{user.name.charAt(0).toUpperCase()}</div>
                <div className="account-details">
                    <div className="account-name">{user.name}</div>
                    <div className="account-email">{user.email}</div>
                    <div className="account-since">Member since {user.memberSince}</div>
                </div>
                <button
                    className="forma-btn"
                    onClick={() => {
                        playSound('click3');
                        onSignOut();
                    }}
                >
                    <Icon name="logout" size={14} /> Sign out
                </button>
            </div>

            <p className="eyebrow">Workspace usage</p>
            <div className="account-stats">
                {STATS.map((stat) => (
                    <div key={stat.label} className="home-stat">
                        <div className="home-stat-value">{stat.value}</div>
                        <div className="home-stat-label">{stat.label}</div>
                        <div className="home-stat-note">{stat.note}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default AccountScreen;