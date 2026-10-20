/*!************************************************************************
\file AccountScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Account page for the signed-in user: profile card (avatar, name, email,
member since), a sign out button, and workspace usage stats counted from
GET /jobs (models, photos, failed builds, processing queue).
**************************************************************************/

import { useEffect, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Turns the GET /jobs list into the four usage cards. The backend has no
// scene storage yet, so the third card counts failed builds instead.
function buildUsageStats(jobs) {
    const weekAgo = Date.now() - ONE_WEEK_MS;
    const isThisWeek = (job) => job.createdAt >= weekAgo;

    const finishedJobs = jobs.filter((job) => job.status === 'done');
    const failedJobs = jobs.filter((job) => job.status === 'error');
    const runningJobs = jobs.filter((job) => job.status === 'running');
    const queuedJobs = jobs.filter((job) => job.status === 'queued');

    const countPhotos = (jobList) => jobList.reduce((total, job) => total + (job.imageCount ?? 0), 0);

    let queueNote = 'Nothing running';
    if (runningJobs.length > 0) {
        queueNote = queuedJobs.length > 0 ? `1 building, ${queuedJobs.length} waiting` : '1 building now';
    } else if (queuedJobs.length > 0) {
        queueNote = `${queuedJobs.length} waiting to start`;
    }

    return [
        { value: finishedJobs.length, label: 'Models Generated', note: `+${finishedJobs.filter(isThisWeek).length} this week` },
        { value: countPhotos(jobs), label: 'Photos Uploaded', note: `+${countPhotos(jobs.filter(isThisWeek))} this week` },
        { value: failedJobs.length, label: 'Failed Builds', note: failedJobs.length > 0 ? 'Try again with more photos' : 'No failed builds' },
        { value: runningJobs.length + queuedJobs.length, label: 'Processing Queue', note: queueNote },
    ];
}

function AccountScreen({ user, onSignOut }) {
    const [jobs, setJobs] = useState([]);
    const [statsStatus, setStatsStatus] = useState('loading');

    useEffect(() => {
        let isCancelled = false;

        async function loadJobs() {
            try {
                const res = await fetch('/jobs');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (!isCancelled) {
                    setJobs(data);
                    setStatsStatus('ready');
                }
            } catch {
                if (!isCancelled) setStatsStatus('error');
            }
        }

        loadJobs();
        return () => {
            isCancelled = true;
        };
    }, []);

    const usageStats = buildUsageStats(jobs);

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
                    {user.isGuest
                        ? <><Icon name="user" size={14} /> Sign in</>
                        : <><Icon name="logout" size={14} /> Sign out</>}
                </button>
            </div>

            <p className="eyebrow">Workspace usage</p>
            {statsStatus === 'error' && <p className="home-recent-note">Could not load usage. Is the server running?</p>}
            <div className="account-stats">
                {usageStats.map((stat) => (
                    <div key={stat.label} className="home-stat">
                        <div className="home-stat-value">{statsStatus === 'ready' ? stat.value : '-'}</div>
                        <div className="home-stat-label">{stat.label}</div>
                        <div className="home-stat-note">{statsStatus === 'ready' ? stat.note : '\u00a0'}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default AccountScreen;