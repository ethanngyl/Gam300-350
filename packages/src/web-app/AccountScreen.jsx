/*!************************************************************************
\file AccountScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 24-10-2026
\brief
Account settings, laid out like the Genesis Figma: a side menu (the
user's photo, name and plan on top, the sections, and Log out at the
bottom) and the chosen section beside it. On wider screens it opens as a
window over the page it was opened from (isModal; the X or Escape closes
it); on phones it is a page, and the menu becomes a row of tabs above the
section. Sections:
- Profile: the user's photo, name, plan and email, counts of their models
  and photos, and their models and photo batches (from GET /jobs).
- My account: profile photo (saved in this browser, see ProfilePhoto.js),
  name, email, password ("Change password" opens ChangePasswordDialog;
  Google-only accounts, per GET /api/v1/auth/me/account, have none),
  sign-in methods, role, member since, "Show walkthrough", log out, and
  Delete account (the user types DELETE to confirm, then DELETE
  /api/v1/auth/me removes the account and signs them out; until the server
  has that route, the dialog says deleting isn't available yet).
  Guests see a sign-in card instead.
- Billing: the current plan and this month's models. Paid plans aren't
  available yet, so there is no payment method or billing history.
- Plans: Genesis Free / Pro / Max compared side by side. A prototype:
  everyone is on Free and paid plans cannot be chosen yet.
- Storage: the plan's storage (storage used isn't reported by the server
  yet) and workspace stats counted from GET /jobs (models, photos, failed
  builds, processing queue).
- Notifications: which notifications the user wants, saved in this
  browser. None are sent yet; the choices are kept for when they are.
- Appearance: the theme (dark, light or follow the device, see
  AppearanceSettings.js), saved in this browser.
- Audio: sound effects on/off and overall volume, then each kind of
  sound (buttons, camera shutter, notifications) on/off with its own
  volume and a Play button to hear it (Audio.js), saved in this browser.
On phones the three preference sections are one simpler Preferences tab:
the theme, sounds on/off and volume, and one switch per notification.
- buildUsageStats(jobs)
Turns the GET /jobs list into the three usage cards.
- AccountScreen({ user, isModal, onClose, onOpenModel, onOpenLibrary,
  onSignOut, onShowWalkthrough })
React component. onSignOut signs out (or, for guests, goes to sign in);
onShowWalkthrough replays the walkthrough; onOpenModel / onOpenLibrary
open a model or the Photo Library from the Profile section.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { jobDisplayName } from './mediaApi.js';
import { CURRENT_PLAN_ID, PLANS } from './plans.js';
import {
    SOUND_CATEGORY_IDS,
    playSound,
    setSoundCategory,
    setSoundMuted,
    setSoundVolume,
    useSoundSettings,
} from '../audio/Audio.js';
import { removeProfilePhoto, saveProfilePhoto, useProfilePhoto } from './ProfilePhoto.js';
import { setTheme, useAppearanceSettings } from './AppearanceSettings.js';
import ChangePasswordDialog from './ChangePasswordDialog.jsx';
import ActionDialog from './ActionDialog.jsx';
import { useMobileView } from './useMobileView.js';
import './AccountScreen.css';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Side menu, in groups like the design.
const SECTION_GROUPS = [
    {
        label: 'Account',
        sections: [
            { id: 'profile', label: 'Profile', icon: 'user' },
            { id: 'account', label: 'My account', icon: 'lock' },
        ],
    },
    {
        label: 'Plan',
        sections: [
            { id: 'billing', label: 'Billing', icon: 'creditCard' },
            { id: 'plans', label: 'Plans', icon: 'sparkle' },
            { id: 'storage', label: 'Storage', icon: 'database' },
        ],
    },
    {
        label: 'Preferences',
        sections: [
            { id: 'notifications', label: 'Notifications', icon: 'bell' },
            { id: 'appearance', label: 'Appearance', icon: 'sun' },
            { id: 'audio', label: 'Audio', icon: 'volume' },
        ],
    },
];

// Delete account: DELETE on this removes the signed-in account (backend).
const DELETE_ACCOUNT_URL = '/api/v1/auth/me';
// What the user types to confirm deleting their account.
const DELETE_CONFIRM_WORD = 'DELETE';

// Phones: the three preference sections are one Preferences tab.
const PREFERENCE_SECTION_IDS = ['notifications', 'appearance', 'audio'];
const PHONE_SECTION_GROUPS = SECTION_GROUPS.map((group) => (
    group.label === 'Preferences'
        ? { ...group, sections: [{ id: 'preferences', label: 'Preferences', icon: 'settings' }] }
        : group
));

// Account > Audio: each kind of sound (Audio.js SOUND_CATEGORY_IDS), with
// the sound its Play button plays.
const SOUND_CATEGORY_DETAILS = {
    buttons: { title: 'Button sounds', hint: 'Taps, confirm and back.', sampleSound: 'tap' },
    camera: { title: 'Camera shutter', hint: 'When you take a photo.', sampleSound: 'camera' },
    notifications: { title: 'Notification sounds', hint: 'Model ready, build failed and build steps.', sampleSound: 'success' },
};

// Account > Appearance theme choices, in order (AppearanceSettings.js).
const THEME_OPTIONS = [
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
    { id: 'system', label: 'Match system', icon: 'monitor' },
];

// Account > Notifications: each choice can go by email and/or in the app.
const NOTIFICATION_GROUPS = [
    {
        label: 'Your work',
        items: [
            { id: 'modelReady', title: 'Model ready', hint: 'When a model finishes processing and is ready to view.' },
            { id: 'processingFailed', title: 'Processing failed', hint: "When a model can't be built from your photos." },
            { id: 'storageAlmostFull', title: 'Storage almost full', hint: "When you've used most of your cloud storage." },
        ],
    },
    {
        label: 'From Genesis',
        items: [
            { id: 'productUpdates', title: 'Product updates', hint: 'New features and improvements.' },
            { id: 'tips', title: 'Tips and tutorials', hint: 'Short guides on getting better scans.' },
        ],
    },
];
const NOTIFICATION_PREFS_KEY = 'genesis-notification-prefs';

// Saved notification choices: { [id]: { email, inApp } }. Everything is on
// until the user changes it. Storage can be blocked, so it is wrapped.
function loadNotificationPrefs() {
    try {
        return JSON.parse(window.localStorage.getItem(NOTIFICATION_PREFS_KEY)) ?? {};
    } catch {
        return {};
    }
}

function saveNotificationPrefs(prefs) {
    try {
        window.localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(prefs));
    } catch {
        // Storage unavailable: the choices last until the page is reloaded.
    }
}

// Turns the GET /jobs list into the three usage cards. The backend has no
// scene storage yet, so the third card counts failed builds instead.
function buildUsageStats(jobs) {
    const weekAgo = Date.now() - ONE_WEEK_MS;
    const isThisWeek = (job) => job.createdAt >= weekAgo;

    const finishedJobs = jobs.filter((job) => job.status === 'done');
    const failedJobs = jobs.filter((job) => job.status === 'error');

    const countPhotos = (jobList) => jobList.reduce((total, job) => total + (job.imageCount ?? 0), 0);

    return [
        { value: finishedJobs.length, label: 'Models Generated', note: `+${finishedJobs.filter(isThisWeek).length} this week` },
        { value: countPhotos(jobs), label: 'Photos Uploaded', note: `+${countPhotos(jobs.filter(isThisWeek))} this week` },
        { value: failedJobs.length, label: 'Failed Builds', note: failedJobs.length > 0 ? 'Try again with more photos' : 'No failed builds' },
    ];
}

function AccountScreen({ user, isModal = false, onClose, onOpenModel, onOpenLibrary, onSignOut, onShowWalkthrough }) {
    const [activeSection, setActiveSection] = useState('account');
    const [profileTab, setProfileTab] = useState('models');
    const [notificationPrefs, setNotificationPrefs] = useState(loadNotificationPrefs);
    const [jobs, setJobs] = useState([]);
    const [statsStatus, setStatsStatus] = useState('loading');
    const [photoError, setPhotoError] = useState(null);
    const [planNotice, setPlanNotice] = useState(null);
    // How the account signs in: { password, google }, or null until
    // GET /auth/me/account answers (the password button just shows).
    const [signInMethods, setSignInMethods] = useState(null);
    // false: Google sign-in only, so there is no password to change.
    const hasPassword = signInMethods ? signInMethods.password !== false : null;
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);
    const [passwordNotice, setPasswordNotice] = useState(null);
    const photoInputRef = useRef(null);
    const { isMuted, volume, categories } = useSoundSettings();
    const isPhone = useMobileView();
    // The section to show: phones show the three preference sections as one.
    let shownSection = activeSection;
    if (isPhone && PREFERENCE_SECTION_IDS.includes(activeSection)) shownSection = 'preferences';
    if (!isPhone && activeSection === 'preferences') shownSection = 'appearance';
    const { theme } = useAppearanceSettings();
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
                if (!isCancelled && account.signInMethods) setSignInMethods(account.signInMethods);
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
    const finishedJobs = jobs.filter((job) => job.status === 'done');
    const photoBatches = jobs.filter((job) => (job.images?.length ?? 0) > 0);
    const photoCount = jobs.reduce((total, job) => total + (job.imageCount ?? 0), 0);

    // Escape closes the window (not while the change password dialog is open).
    useEffect(() => {
        if (!isModal) return undefined;
        function closeOnEscape(event) {
            if (event.key === 'Escape' && !isChangingPassword) onClose();
        }
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [isModal, isChangingPassword, onClose]);

    function setNotificationPref(id, channel, isOn) {
        playSound('tap');
        setNotificationPrefs((prefs) => {
            const next = { ...prefs, [id]: { email: true, inApp: true, ...prefs[id], [channel]: isOn } };
            saveNotificationPrefs(next);
            return next;
        });
    }

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

    // Delete account: the typed word must match, then the server removes the
    // account and its files and the user is signed out to the landing page.
    // Errors show in the dialog (ActionDialog shows a rejected promise's message).
    async function deleteAccount(typedWord) {
        if (typedWord.trim().toUpperCase() !== DELETE_CONFIRM_WORD) {
            throw new Error(`Type ${DELETE_CONFIRM_WORD} to confirm.`);
        }
        let response;
        try {
            response = await fetch(DELETE_ACCOUNT_URL, { method: 'DELETE', credentials: 'same-origin' });
        } catch {
            throw new Error("Couldn't reach the server. Check your connection and try again.");
        }
        if (response.status === 404 || response.status === 405) {
            throw new Error("Deleting accounts isn't available on this server yet.");
        }
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error ?? `Couldn't delete your account (error ${response.status}).`);
        }
        setIsDeletingAccount(false);
        onSignOut();
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
                    {signInMethods && (
                        <div className="acct-row">
                            <dt>Sign-in methods</dt>
                            <dd className="acct-sign-in-methods">
                                {signInMethods.password !== false && <span><Icon name="mail" size={14} /> Email and password</span>}
                                {signInMethods.google && <span><Icon name="check" size={14} /> Google {'\u00b7'} connected</span>}
                            </dd>
                        </div>
                    )}
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

                <div className="forma-card acct-card acct-leave">
                    <div className="acct-leave-row">
                        <div>
                            <h2 className="acct-card-title">Log out</h2>
                            <p className="acct-muted">Sign out of Genesis on this device.</p>
                        </div>
                        {renderSignOutButton()}
                    </div>
                    <div className="acct-leave-row">
                        <div>
                            <h2 className="acct-card-title acct-danger-title">Delete account</h2>
                            <p className="acct-muted">
                                Permanently removes your account, models and source photos. This can't be undone.
                            </p>
                        </div>
                        <button
                            className="forma-btn acct-danger-button"
                            onClick={() => {
                                playSound('tap');
                                setIsDeletingAccount(true);
                            }}
                        >
                            <Icon name="trash" size={14} /> Delete account
                        </button>
                    </div>
                </div>
                {isDeletingAccount && (
                    <ActionDialog
                        title="Delete your account?"
                        message={`This permanently removes ${user.email}, every model and every source photo. Type ${DELETE_CONFIRM_WORD} to confirm.`}
                        initialValue=""
                        placeholder={DELETE_CONFIRM_WORD}
                        confirmLabel="Delete account"
                        danger
                        onConfirm={deleteAccount}
                        onCancel={() => setIsDeletingAccount(false)}
                    />
                )}
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

    function renderSectionHeading(eyebrow, title, subtitle) {
        return (
            <div className="acct-section-heading">
                <p className="eyebrow eyebrow-accent">{eyebrow}</p>
                <h1 className="acct-title">{title}</h1>
                {subtitle && <p className="acct-subtitle">{subtitle}</p>}
            </div>
        );
    }

    function renderProfileSection() {
        const items = profileTab === 'models' ? finishedJobs : photoBatches;
        return (
            <>
                <div className="forma-card acct-card acct-profile-head">
                    {renderAvatar('acct-avatar-large', 40)}
                    <div className="acct-profile-identity">
                        <h1 className="acct-title">
                            {user.name}
                            <span className="acct-plan-chip">{user.isGuest ? 'Guest' : currentPlan.name.replace('Genesis ', '')}</span>
                        </h1>
                        <p className="acct-muted">{user.email}</p>
                    </div>
                </div>

                <div className="forma-card acct-profile-stats">
                    <div><strong>{statsStatus === 'ready' ? finishedJobs.length : '-'}</strong><span>Models</span></div>
                    <div><strong>{statsStatus === 'ready' ? photoBatches.length : '-'}</strong><span>Photo batches</span></div>
                    <div><strong>{statsStatus === 'ready' ? photoCount : '-'}</strong><span>Photos</span></div>
                </div>

                <div className="acct-tabs" role="tablist">
                    {[['models', 'Models', finishedJobs.length], ['photos', 'Source photos', photoBatches.length]].map(([id, label, count]) => (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={profileTab === id}
                            className={profileTab === id ? 'acct-tab is-active' : 'acct-tab'}
                            onClick={() => {
                                playSound('tap');
                                setProfileTab(id);
                            }}
                        >
                            {label} <span>{count}</span>
                        </button>
                    ))}
                </div>

                {statsStatus === 'error' && <p className="acct-muted">Could not load your work. Is the server running?</p>}
                {statsStatus === 'ready' && items.length === 0 && (
                    <p className="acct-muted">{profileTab === 'models' ? 'No finished models yet.' : 'No photos yet.'}</p>
                )}
                <div className="acct-profile-grid">
                    {items.map((job) => (
                        <button
                            key={job.id}
                            type="button"
                            className="acct-profile-item"
                            onClick={() => {
                                playSound('tap');
                                if (profileTab === 'models') onOpenModel(job.id);
                                else onOpenLibrary('photos');
                            }}
                        >
                            <span className="acct-profile-cover">
                                {job.images?.[0]
                                    ? <img src={job.images[0].url} alt="" loading="lazy" />
                                    : <Icon name="cube" size={22} />}
                            </span>
                            <strong>{jobDisplayName(job, profileTab === 'models' ? 'Model' : 'Photos')}</strong>
                            <span>{profileTab === 'models' ? '3D model' : `${job.images.length} photos`}</span>
                        </button>
                    ))}
                </div>
            </>
        );
    }

    function renderBillingSection() {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const modelsThisMonth = finishedJobs.filter((job) => job.createdAt >= monthStart.getTime()).length;
        return (
            <>
                {renderSectionHeading('Plan', 'Billing', 'Your plan and payments.')}
                <div className="forma-card acct-card acct-billing-plan">
                    <div>
                        <p className="acct-label">Current plan</p>
                        <h2 className="acct-card-title">{currentPlan.name}</h2>
                        <p className="acct-muted">No payment needed. Paid plans are coming later.</p>
                    </div>
                    <button type="button" className="forma-btn forma-btn-primary" onClick={() => openSection('plans')}>
                        Change plan
                    </button>
                </div>
                <div className="acct-summary-grid">
                    <div className="forma-card acct-summary">
                        <p className="acct-label">Storage</p>
                        <strong>{'\u2014'} of {currentPlan.storage}</strong>
                        <span className="acct-muted">Storage use coming soon</span>
                    </div>
                    <div className="forma-card acct-summary">
                        <p className="acct-label">Models this month</p>
                        <strong>{statsStatus === 'ready' ? modelsThisMonth : '-'} of {currentPlan.models}</strong>
                    </div>
                    <div className="forma-card acct-summary">
                        <p className="acct-label">Billing cycle</p>
                        <strong>None</strong>
                        <span className="acct-muted">Free plan</span>
                    </div>
                </div>
                <div className="forma-card acct-card">
                    <h2 className="acct-card-title">Payment method</h2>
                    <p className="acct-muted">No payment method. You can add one when paid plans are available.</p>
                </div>
                <div className="forma-card acct-card">
                    <h2 className="acct-card-title">Billing history</h2>
                    <p className="acct-muted">No invoices yet.</p>
                </div>
            </>
        );
    }

    function renderStorageSection() {
        return (
            <>
                {renderSectionHeading('Plan', 'Cloud storage', `${currentPlan.name} includes ${currentPlan.storage}.`)}
                <div className="acct-summary-grid is-four">
                    <div className="forma-card acct-summary">
                        <p className="acct-label">Used</p>
                        <strong>{'\u2014'}</strong>
                        <span className="acct-muted">Coming soon</span>
                    </div>
                    <div className="forma-card acct-summary">
                        <p className="acct-label">Plan storage</p>
                        <strong>{currentPlan.storage}</strong>
                    </div>
                    <div className="forma-card acct-summary">
                        <p className="acct-label">Models</p>
                        <strong>{statsStatus === 'ready' ? finishedJobs.length : '-'}</strong>
                    </div>
                    <div className="forma-card acct-summary">
                        <p className="acct-label">Photos</p>
                        <strong>{statsStatus === 'ready' ? photoCount : '-'}</strong>
                    </div>
                </div>
                <p className="acct-notice" role="note">
                    How much storage you've used will show here once the server reports it.
                </p>

                <h2 className="acct-subheading">Workspace usage</h2>
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

    function renderNotificationsSection() {
        return (
            <>
                {renderSectionHeading('Preferences', 'Notifications', 'Choose what you hear about. Saved for this browser.')}
                {NOTIFICATION_GROUPS.map((group) => (
                    <div key={group.label} className="forma-card acct-card acct-notification-group">
                        <p className="acct-label">{group.label}</p>
                        {group.items.map((item) => {
                            const pref = { email: true, inApp: true, ...notificationPrefs[item.id] };
                            return (
                                <div key={item.id} className="acct-notification-row">
                                    <div>
                                        <strong>{item.title}</strong>
                                        <span className="acct-muted">{item.hint}</span>
                                    </div>
                                    {[['email', 'Email'], ['inApp', 'In app']].map(([channel, label]) => (
                                        <label key={channel} className="acct-switch-label">
                                            {label}
                                            <input
                                                type="checkbox"
                                                className="forma-switch"
                                                checked={pref[channel]}
                                                onChange={(event) => setNotificationPref(item.id, channel, event.target.checked)}
                                                aria-label={`${item.title}: ${label}`}
                                            />
                                        </label>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                ))}
                <p className="acct-notice" role="note">Genesis doesn't send notifications yet. Your choices are kept for when it does.</p>
            </>
        );
    }

    // isCompact: phones, three small buttons without the previews.
    function renderThemeOptions(isCompact = false) {
        return (
            <div className={isCompact ? 'acct-theme-options is-compact' : 'acct-theme-options'} role="radiogroup" aria-label="Theme">
                {THEME_OPTIONS.map((option) => (
                    <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={theme === option.id}
                        className={theme === option.id ? 'acct-theme-option is-active' : 'acct-theme-option'}
                        onClick={() => {
                            playSound('tap');
                            setTheme(option.id);
                        }}
                    >
                        <span className={`acct-theme-swatch is-${option.id}`} aria-hidden="true" />
                        <span className="acct-theme-name">
                            <Icon name={option.icon} size={14} /> {isCompact && option.id === 'system' ? 'System' : option.label}
                        </span>
                    </button>
                ))}
            </div>
        );
    }

    // UI sounds on/off and the overall volume (Audio and phone Preferences).
    function renderSoundCard() {
        return (
            <div className="forma-card account-sound">
                <label className="account-sound-row">
                    <span className="account-sound-icon">
                        <Icon name={isMuted ? 'volumeOff' : 'volume'} size={18} />
                    </span>
                    <span className="account-sound-text">
                        <span className="account-sound-title">UI sounds</span>
                        <span className="account-sound-hint">All of Genesis's sounds. Saved for this browser.</span>
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
                        aria-label="UI sounds"
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
        );
    }

    function renderAppearanceSection() {
        return (
            <>
                {renderSectionHeading('Preferences', 'Appearance', 'How Genesis looks on this browser.')}
                <div className="forma-card acct-card">
                    <p className="acct-label">Theme</p>
                    {renderThemeOptions()}
                </div>
            </>
        );
    }

    function renderAudioSection() {
        return (
            <>
                {renderSectionHeading('Preferences', 'Audio', 'Which sounds Genesis plays, and how loud. Saved for this browser.')}
                {renderSoundCard()}

                <div className={isMuted ? 'forma-card acct-card acct-sound-types is-disabled' : 'forma-card acct-card acct-sound-types'}>
                    <p className="acct-label">Sounds</p>
                    {SOUND_CATEGORY_IDS.map((categoryId) => {
                        const details = SOUND_CATEGORY_DETAILS[categoryId];
                        const category = categories[categoryId];
                        const categoryPercent = Math.round(category.volume * 100);
                        const isOff = isMuted || !category.isEnabled;
                        return (
                            <div key={categoryId} className="acct-sound-type">
                                <div className="acct-sound-type-head">
                                    <div>
                                        <strong>{details.title}</strong>
                                        <span className="acct-muted">{details.hint}</span>
                                    </div>
                                    <button
                                        type="button"
                                        className="forma-btn acct-sound-play"
                                        disabled={isOff}
                                        onClick={() => playSound(details.sampleSound)}
                                        aria-label={`Play ${details.title.toLowerCase()}`}
                                    >
                                        <Icon name="playSolid" size={12} /> Play
                                    </button>
                                    <input
                                        type="checkbox"
                                        className="forma-switch"
                                        checked={category.isEnabled}
                                        disabled={isMuted}
                                        onChange={(event) => setSoundCategory(categoryId, { isEnabled: event.target.checked })}
                                        aria-label={details.title}
                                    />
                                </div>
                                <label className={isOff ? 'account-sound-volume is-disabled' : 'account-sound-volume'}>
                                    <span>Volume <b>{categoryPercent}%</b></span>
                                    <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        step={5}
                                        value={categoryPercent}
                                        disabled={isOff}
                                        onChange={(event) => setSoundCategory(categoryId, { volume: Number(event.target.value) / 100 })}
                                        onPointerUp={() => playSound(details.sampleSound)}
                                        onKeyUp={() => playSound(details.sampleSound)}
                                        aria-label={`${details.title} volume`}
                                    />
                                </label>
                            </div>
                        );
                    })}
                </div>
            </>
        );
    }

    // Phones: theme, sounds and notifications together, with fewer choices.
    function renderPhonePreferencesSection() {
        return (
            <>
                {renderSectionHeading('Preferences', 'Preferences', 'Saved for this browser.')}
                <div className="forma-card acct-card">
                    <p className="acct-label">Theme</p>
                    {renderThemeOptions(true)}
                </div>

                {renderSoundCard()}

                <div className="forma-card acct-card acct-notification-group">
                    <p className="acct-label">Notify me about</p>
                    {NOTIFICATION_GROUPS.flatMap((group) => group.items).map((item) => {
                        const pref = { email: true, inApp: true, ...notificationPrefs[item.id] };
                        const isOn = pref.email || pref.inApp;
                        return (
                            <label key={item.id} className="acct-notification-row is-simple">
                                <strong>{item.title}</strong>
                                <input
                                    type="checkbox"
                                    className="forma-switch"
                                    checked={isOn}
                                    onChange={(event) => {
                                        // One switch for both email and in-app on phones.
                                        setNotificationPref(item.id, 'email', event.target.checked);
                                        setNotificationPref(item.id, 'inApp', event.target.checked);
                                    }}
                                    aria-label={item.title}
                                />
                            </label>
                        );
                    })}
                </div>
            </>
        );
    }

    const screen = (
        <div className={isModal ? 'acct-screen is-modal' : 'acct-screen'}>
            <nav className="forma-card acct-menu" aria-label="Account sections">
                <div className="acct-menu-user">
                    {renderAvatar('acct-avatar-small', 18)}
                    <div className="acct-menu-identity">
                        <strong>{user.name}</strong>
                        <span>{user.isGuest ? 'Guest' : currentPlan.name}</span>
                    </div>
                </div>

                {(isPhone ? PHONE_SECTION_GROUPS : SECTION_GROUPS).map((group) => (
                    <div key={group.label} className="acct-menu-group">
                        <span className="acct-menu-label">{group.label}</span>
                        {group.sections.map((section) => (
                            <button
                                key={section.id}
                                className={shownSection === section.id ? 'acct-menu-item is-active' : 'acct-menu-item'}
                                onClick={() => openSection(section.id)}
                                aria-current={shownSection === section.id ? 'page' : undefined}
                            >
                                <Icon name={section.icon} size={16} />
                                <span>{section.label}</span>
                            </button>
                        ))}
                    </div>
                ))}

                <button
                    type="button"
                    className="acct-menu-item acct-menu-logout"
                    onClick={() => {
                        playSound('back');
                        onSignOut();
                    }}
                >
                    <Icon name={user.isGuest ? 'user' : 'logout'} size={16} />
                    <span>{user.isGuest ? 'Sign in' : 'Log out'}</span>
                </button>
            </nav>

            <div className="acct-content">
                {isModal && (
                    <button
                        type="button"
                        className="acct-close"
                        aria-label="Close account settings"
                        onClick={() => {
                            playSound('back');
                            onClose();
                        }}
                    >
                        <Icon name="close" size={16} />
                    </button>
                )}
                {shownSection === 'profile' && renderProfileSection()}
                {shownSection === 'account' && renderAccountSection()}
                {shownSection === 'billing' && renderBillingSection()}
                {shownSection === 'plans' && renderPlansSection()}
                {shownSection === 'storage' && renderStorageSection()}
                {shownSection === 'notifications' && renderNotificationsSection()}
                {shownSection === 'appearance' && renderAppearanceSection()}
                {shownSection === 'audio' && renderAudioSection()}
                {shownSection === 'preferences' && renderPhonePreferencesSection()}
            </div>
        </div>
    );

    if (!isModal) return screen;

    return (
        <div
            className="acct-modal-backdrop"
            onPointerDown={(event) => {
                // A press on the dimmed page around the window closes it.
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="acct-modal" role="dialog" aria-modal="true" aria-label="Account settings">
                {screen}
            </div>
        </div>
    );
}

export default AccountScreen;