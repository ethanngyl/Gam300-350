/*!************************************************************************
\file AccountScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 24-10-2026
\brief
Account page, laid out like the Genesis account settings design: a side
menu (the user's photo, name and plan on top, then the sections) and the
chosen section beside it. On phones the menu becomes a row of tabs above
the section. Sections:
- My account: profile photo (saved in this browser, see ProfilePhoto.js),
  name, email, password ("Change password" opens ChangePasswordDialog;
  Google-only accounts, per GET /api/v1/auth/me/account, have none), role,
  member since, "Show walkthrough" (replays the workspace tour), and log out.
  Guests see a sign-in card instead.
- Plans: Genesis Free / Plus / Pro compared side by side. A prototype:
  everyone is on Free and paid plans cannot be chosen yet.
- Usage: workspace stats counted from GET /jobs (models, photos, failed
  builds, processing queue).
- Sound: sound effects on/off and volume, saved in this browser.
- buildUsageStats(jobs)
Turns the GET /jobs list into the four usage cards.
- AccountScreen({ user, onSignOut, onShowWalkthrough })
React component. onSignOut signs out (or, for guests, goes to sign in);
onShowWalkthrough replays the walkthrough.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound, setSoundMuted, setSoundVolume, useSoundSettings } from '../audio/Audio.js';
import { removeProfilePhoto, saveProfilePhoto, useProfilePhoto } from './ProfilePhoto.js';
import ChangePasswordDialog from './ChangePasswordDialog.jsx';
import ThemeSwitch from './ThemeSwitch.jsx';
import './AccountScreen.css';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Side menu, in groups like the design.
const SECTION_GROUPS = [
    { label: 'Account', sections: [{ id: 'account', label: 'My account', icon: 'settings' }] },
    {
        label: 'Plan',
        sections: [
            { id: 'plans', label: 'Plans', icon: 'layers' },
            { id: 'usage', label: 'Usage', icon: 'cube' },
        ],
    },
    {
        label: 'Preferences',
        sections: [
            { id: 'appearance', label: 'Appearance', icon: 'sun' },
            { id: 'sound', label: 'Sound', icon: 'volume' },
        ],
    },
];

// Prototype plans; not final plan details. Everyone is on Free for now.
const CURRENT_PLAN_ID = 'free';
const PLANS = [
    {
        id: 'free',
        name: 'Genesis Free',
        description: 'Everything you need to get started.',
        storage: '8 GB',
        models: '12',
        formats: ['.ply'],
    },
    {
        id: 'plus',
        name: 'Genesis Plus',
        description: 'More room for bigger projects.',
        storage: '16 GB',
        models: '32',
        formats: ['.ply', '.splat', 'point-cloud .ply'],
    },
    {
        id: 'pro',
        name: 'Genesis Pro',
        description: 'Unlimited models and every export format.',
        storage: '32 GB',
        models: 'Unlimited*',
        formats: ['.ply', '.splat', 'point-cloud .ply', '.obj', '.glb', '.stl'],
        isFeatured: true,
    },
];

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

function AccountScreen({ user, onSignOut, onShowWalkthrough }) {
    const [activeSection, setActiveSection] = useState('account');
    const [jobs, setJobs] = useState([]);
    const [statsStatus, setStatsStatus] = useState('loading');
    const [photoError, setPhotoError] = useState(null);
    const [planNotice, setPlanNotice] = useState(null);
    // Whether the account has a password (false: Google sign-in only); null
    // until GET /auth/me/account answers, and then the button just shows.
    const [hasPassword, setHasPassword] = useState(null);
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [passwordNotice, setPasswordNotice] = useState(null);
    const photoInputRef = useRef(null);
    const { isMuted, volume } = useSoundSettings();
    const profilePhoto = useProfilePhoto(user.email);
    const volumePercent = Math.round(volume * 100);
    const currentPlan = PLANS.find((plan) => plan.id === CURRENT_PLAN_ID);

    useEffect(() => {
        let isCancelled = false;

        async function loadJobs() {
            try {
                const res = await fetch('/api/v1/jobs');
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

    // Which ways the account signs in, so Google-only accounts aren't offered
    // a password change. If this fails the button stays; the server refuses
    // a Google-only account anyway.
    useEffect(() => {
        if (user.isGuest) return undefined;
        let isCancelled = false;

        async function loadSignInMethods() {
            try {
                const res = await fetch('/api/v1/auth/me/account');
                if (!res.ok) return;
                const account = await res.json();
                if (!isCancelled) setHasPassword(account.signInMethods?.password !== false);
            } catch {
                // Keep the button.
            }
        }

        loadSignInMethods();
        return () => {
            isCancelled = true;
        };
    }, [user.isGuest, user.email]);

    const usageStats = buildUsageStats(jobs);

    async function handlePhotoChosen(event) {
        const chosenFile = event.target.files?.[0];
        // Clear so choosing the same file again still fires onChange.
        event.target.value = '';
        if (!chosenFile) return;
        setPhotoError(null);
        try {
            await saveProfilePhoto(user.email, chosenFile);
            playSound('confirm');
        } catch (err) {
            setPhotoError(err.message);
        }
    }

    function openSection(sectionId) {
        playSound('tap');
        setPlanNotice(null);
        setActiveSection(sectionId);
    }

    function renderAvatar(className, iconSize) {
        return (
            <span className={`acct-avatar ${className}`}>
                {profilePhoto
                    ? <img src={profilePhoto} alt="" />
                    : <Icon name="user" size={iconSize} />}
            </span>
        );
    }

    function renderSignOutButton() {
        return (
            <button
                className="forma-btn"
                onClick={() => {
                    playSound('back');
                    onSignOut();
                }}
            >
                {user.isGuest
                    ? <><Icon name="user" size={14} /> Sign in</>
                    : <><Icon name="logout" size={14} /> Log out</>}
            </button>
        );
    }

    function renderAccountSection() {
        if (user.isGuest) {
            return (
                <>
                    <div className="acct-section-heading">
                        <p className="eyebrow eyebrow-accent">Account</p>
                        <h1 className="acct-title">My account</h1>
                        <p className="acct-subtitle">You are browsing as a guest.</p>
                    </div>
                    <div className="forma-card acct-card acct-guest">
                        <span className="acct-guest-icon"><Icon name="lock" size={22} /></span>
                        <div className="acct-guest-text">
                            <h2 className="acct-card-title">Sign in to manage your account</h2>
                            <p className="acct-muted">
                                Guests have no account to manage. Sign in or create an account to
                                keep your models, choose a plan and send feedback.
                            </p>
                        </div>
                        {renderSignOutButton()}
                    </div>
                </>
            );
        }

        return (
            <>
                <div className="acct-section-heading">
                    <p className="eyebrow eyebrow-accent">Account</p>
                    <h1 className="acct-title">My account</h1>
                    <p className="acct-subtitle">Your details and how you sign in to Genesis.</p>
                </div>

                <div className="forma-card acct-card acct-photo">
                    {renderAvatar('acct-avatar-large', 40)}
                    <div className="acct-photo-text">
                        <h2 className="acct-card-title">Profile photo</h2>
                        <p className="acct-muted">
                            Choose a clear image so your profile is easy to recognise. Saved on this
                            device only.
                        </p>
                        <div className="acct-photo-actions">
                            <button
                                className="forma-btn"
                                onClick={() => {
                                    playSound('tap');
                                    photoInputRef.current?.click();
                                }}
                            >
                                <Icon name="upload" size={14} /> {profilePhoto ? 'Change photo' : 'Upload photo'}
                            </button>
                            {profilePhoto && (
                                <button
                                    className="forma-btn acct-btn-quiet"
                                    onClick={() => {
                                        playSound('back');
                                        removeProfilePhoto(user.email);
                                    }}
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                        {photoError && <p className="acct-error" role="alert">{photoError}</p>}
                        <input
                            ref={photoInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoChosen}
                            style={{ display: 'none' }}
                        />
                    </div>
                </div>

                <dl className="forma-card acct-card acct-details">
                    <div className="acct-row">
                        <dt>Name</dt>
                        <dd>{user.name}</dd>
                    </div>
                    <div className="acct-row">
                        <dt>Email</dt>
                        <dd className="acct-email">{user.email}</dd>
                    </div>
                    <div className="acct-row">
                        <dt>Password</dt>
                        {hasPassword === false ? (
                            // Google-only accounts have no password to change.
                            <dd className="acct-muted">Signs in with Google</dd>
                        ) : (
                            <>
                                <dd>
                                    <span className="acct-password-dots" aria-label="Hidden">{'\u2022'.repeat(10)}</span>
                                </dd>
                                <button
                                    className="forma-btn acct-row-action"
                                    onClick={() => {
                                        playSound('tap');
                                        setPasswordNotice(null);
                                        setIsChangingPassword(true);
                                    }}
                                >
                                    <Icon name="lock" size={14} /> Change password
                                </button>
                            </>
                        )}
                    </div>
                    {user.role === 'admin' && (
                        <div className="acct-row">
                            <dt>Role</dt>
                            <dd><span className="forma-badge forma-badge-ready">Administrator</span></dd>
                        </div>
                    )}
                    <div className="acct-row">
                        <dt>Member since</dt>
                        <dd>{user.memberSince}</dd>
                    </div>
                </dl>
                {passwordNotice && <p className="acct-notice" role="status">{passwordNotice}</p>}
                {isChangingPassword && (
                    <ChangePasswordDialog
                        onChanged={() => {
                            setIsChangingPassword(false);
                            setPasswordNotice('Password changed. Other browsers signed in to your account were signed out.');
                        }}
                        onCancel={() => setIsChangingPassword(false)}
                    />
                )}

                <div className="forma-card acct-card acct-logout">
                    <div>
                        <h2 className="acct-card-title">Walkthrough</h2>
                        <p className="acct-muted">Take the quick tour of the workspace again.</p>
                    </div>
                    <button
                        className="forma-btn"
                        onClick={() => {
                            playSound('tap');
                            onShowWalkthrough();
                        }}
                    >
                        <Icon name="refresh" size={14} /> Show walkthrough
                    </button>
                </div>

                <div className="forma-card acct-card acct-logout">
                    <div>
                        <h2 className="acct-card-title">Log out</h2>
                        <p className="acct-muted">Sign out of Genesis on this device.</p>
                    </div>
                    {renderSignOutButton()}
                </div>
            </>
        );
    }

    function renderPlansSection() {
        return (
            <>
                <div className="acct-section-heading">
                    <p className="eyebrow eyebrow-accent">Plans</p>
                    <h1 className="acct-title">Compare plans</h1>
                    <p className="acct-subtitle">This is a prototype and does not reflect final plan details.</p>
                </div>

                {/* Above the cards, so it is in view on phones where the cards stack. */}
                {planNotice && <p className="acct-notice" role="status">{planNotice}</p>}

                <div className="acct-plans">
                    {PLANS.map((plan) => {
                        const isCurrent = plan.id === CURRENT_PLAN_ID;
                        const cardClassName = [
                            'forma-card',
                            'acct-plan',
                            isCurrent ? 'is-current' : '',
                            plan.isFeatured ? 'is-featured' : '',
                        ].join(' ').trim();

                        return (
                            <div key={plan.id} className={cardClassName}>
                                {plan.isFeatured && <span className="acct-plan-flag">Most popular</span>}
                                <div className="acct-plan-head">
                                    <h2 className="acct-plan-name">{plan.name}</h2>
                                    {isCurrent && <span className="acct-plan-current">Current plan</span>}
                                </div>
                                <p className="acct-muted">{plan.description}</p>

                                <ul className="acct-plan-features">
                                    <li>
                                        <span className="acct-plan-check"><Icon name="check" size={11} /></span>
                                        <span>Maximum cloud storage<strong>{plan.storage}</strong></span>
                                    </li>
                                    <li>
                                        <span className="acct-plan-check"><Icon name="check" size={11} /></span>
                                        <span>Maximum stored models<strong>{plan.models}</strong></span>
                                    </li>
                                    <li>
                                        <span className="acct-plan-check"><Icon name="check" size={11} /></span>
                                        <span>
                                            Supported export formats
                                            <strong>{plan.formats.join(', ')}</strong>
                                        </span>
                                    </li>
                                </ul>

                                <button
                                    className={plan.isFeatured ? 'forma-btn forma-btn-primary acct-plan-btn' : 'forma-btn acct-plan-btn'}
                                    disabled={isCurrent}
                                    onClick={() => {
                                        playSound('tap');
                                        setPlanNotice(
                                            user.isGuest
                                                ? 'Sign in to choose a plan.'
                                                : `${plan.name} is not available yet. Paid plans are coming later; you are on ${currentPlan.name} for now.`,
                                        );
                                    }}
                                >
                                    {isCurrent ? 'Your current plan' : 'Choose plan'}
                                </button>
                            </div>
                        );
                    })}
                </div>

                <p className="acct-footnote">* Within fair use.</p>
            </>
        );
    }

    function renderUsageSection() {
        return (
            <>
                <div className="acct-section-heading">
                    <p className="eyebrow eyebrow-accent">Usage</p>
                    <h1 className="acct-title">Workspace usage</h1>
                    <p className="acct-subtitle">What you have built so far.</p>
                </div>
                {statsStatus === 'error' && <p className="acct-muted">Could not load usage. Is the server running?</p>}
                <div className="account-stats">
                    {usageStats.map((stat) => (
                        <div key={stat.label} className="home-stat">
                            <div className="home-stat-value">{statsStatus === 'ready' ? stat.value : '-'}</div>
                            <div className="home-stat-label">{stat.label}</div>
                            <div className="home-stat-note">{statsStatus === 'ready' ? stat.note : '\u00a0'}</div>
                        </div>
                    ))}
                </div>
            </>
        );
    }

    function renderAppearanceSection() {
        return (
            <>
                <div className="acct-section-heading">
                    <p className="eyebrow eyebrow-accent">Preferences</p>
                    <h1 className="acct-title">Appearance</h1>
                    <p className="acct-subtitle">Choose how Genesis looks. 3D views stay dark in both themes.</p>
                </div>
                <div className="forma-card account-appearance">
                    <div className="account-appearance-text">
                        <span className="account-sound-title">Theme</span>
                        <span className="account-sound-hint">
                            System follows your device&apos;s light or dark setting. Saved for this browser.
                        </span>
                    </div>
                    <ThemeSwitch className="account-appearance-switch" />
                </div>
            </>
        );
    }

    function renderSoundSection() {
        return (
            <>
                <div className="acct-section-heading">
                    <p className="eyebrow eyebrow-accent">Preferences</p>
                    <h1 className="acct-title">Sound</h1>
                    <p className="acct-subtitle">Choose how Genesis sounds.</p>
                </div>
                <div className="forma-card account-sound">
                    <label className="account-sound-row">
                        <span className="account-sound-icon">
                            <Icon name={isMuted ? 'volumeOff' : 'volume'} size={18} />
                        </span>
                        <span className="account-sound-text">
                            <span className="account-sound-title">Sound effects</span>
                            <span className="account-sound-hint">Button clicks and alerts. Saved for this browser.</span>
                        </span>
                        <input
                            type="checkbox"
                            className="forma-switch"
                            checked={!isMuted}
                            onChange={(event) => {
                                const isTurningOn = event.target.checked;
                                setSoundMuted(!isTurningOn);
                                // Play once when turning on, so the user hears it worked.
                                if (isTurningOn) playSound('tap');
                            }}
                            aria-label="Sound effects"
                        />
                    </label>

                    <label className={isMuted ? 'account-sound-volume is-disabled' : 'account-sound-volume'}>
                        <span>Volume <b>{volumePercent}%</b></span>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={volumePercent}
                            disabled={isMuted}
                            onChange={(event) => setSoundVolume(Number(event.target.value) / 100)}
                            // Preview the new level once the slider is let go.
                            onPointerUp={() => playSound('tap')}
                            onKeyUp={() => playSound('tap')}
                        />
                    </label>
                </div>
            </>
        );
    }

    return (
        <div className="acct-screen">
            <nav className="forma-card acct-menu" aria-label="Account sections">
                <div className="acct-menu-user">
                    {renderAvatar('acct-avatar-small', 18)}
                    <div className="acct-menu-identity">
                        <strong>{user.name}</strong>
                        <span>{user.isGuest ? 'Guest' : currentPlan.name}</span>
                    </div>
                </div>

                {SECTION_GROUPS.map((group) => (
                    <div key={group.label} className="acct-menu-group">
                        <span className="acct-menu-label">{group.label}</span>
                        {group.sections.map((section) => (
                            <button
                                key={section.id}
                                className={activeSection === section.id ? 'acct-menu-item is-active' : 'acct-menu-item'}
                                onClick={() => openSection(section.id)}
                                aria-current={activeSection === section.id ? 'page' : undefined}
                            >
                                <Icon name={section.icon} size={16} />
                                <span>{section.label}</span>
                            </button>
                        ))}
                    </div>
                ))}
            </nav>

            <div className="acct-content">
                {activeSection === 'account' && renderAccountSection()}
                {activeSection === 'plans' && renderPlansSection()}
                {activeSection === 'usage' && renderUsageSection()}
                {activeSection === 'appearance' && renderAppearanceSection()}
                {activeSection === 'sound' && renderSoundSection()}
            </div>
        </div>
    );
}

export default AccountScreen;