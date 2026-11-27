/*!************************************************************************
\file TopNav.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 09-10-2026
\brief
Top bar of the app, laid out like the Genesis Figma. Left to right:
- the GENESIS logo, which opens Home;
- search: finds the user's models and photo batches by name (from
  GET /jobs, loaded when the box is focused). Arrow keys move through the
  results, Enter opens one: a finished model opens its model page, a photo
  batch opens the Photo Library;
- the storage meter, showing the current plan's storage. Display only for
  now: the backend doesn't report storage used yet;
- settings (a gear, as in the Figma), which opens account settings at
  Notifications. The theme is changed in Account > Appearance;
- notifications: a panel that says there are none yet (placeholder);
- the user's avatar, whose menu shows their name and email, "Manage
  account", their plan and storage, Send feedback (the Feedback page,
  moved here from the sidebar as in the Figma), sound on/off, and Log out
  (or Sign in for guests).
On phones (isCompact) it is the mobile Figma's top bar: the logo (or
"Back to home" on other pages, isBackToHome), then a search button that
opens the search box in a row under the bar,
notifications and the avatar. The storage meter and the
gear are left out, and the avatar menu also has "Show walkthrough", since
phones have no Learn button.
- TopNav({ user, isCompact, isBackToHome, onGoHome, onOpenModel, onOpenLibrary,
  onOpenSettings, onOpenFeedback, onOpenAccount, onShowWalkthrough, onSignOut })
React component.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import genesisLogo from '../assets/GenesisLogo.svg';
import { jobDisplayName } from '../lib/mediaApi.js';
import { currentPlan } from '../lib/plans.js';
import { useProfilePhoto } from '../account/ProfilePhoto.js';
import { playSound, setSoundMuted, useSoundSettings } from '../../audio/Audio.js';

// Most results the search shows at once.
const MAX_SEARCH_RESULTS = 8;

// Initials for the avatar when there is no profile photo ("Shaun Li" -> "SL").
function initialsOf(name) {
    const words = (name || '').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('') || '?';
}

// Closes a popup (menu or panel) on a click outside ref, or on Escape.
function useCloseOnOutsideClick(isOpen, ref, close) {
    useEffect(() => {
        if (!isOpen) return undefined;
        function closeOnOutsideClick(event) {
            if (!ref.current?.contains(event.target)) close();
        }
        function closeOnEscape(event) {
            if (event.key === 'Escape') close();
        }
        document.addEventListener('pointerdown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isOpen, ref, close]);
}

// autoFocus: focus the box as soon as it appears (the phone search row).
// onResultOpened: called after a result is opened.
function SearchBox({ onOpenModel, onOpenLibrary, autoFocus = false, onResultOpened }) {
    const [query, setQuery] = useState('');
    const [jobs, setJobs] = useState(null);
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const searchRef = useRef(null);
    useCloseOnOutsideClick(isOpen, searchRef, () => setIsOpen(false));

    // Loads the user's jobs each time the box is focused, so new work shows up.
    async function loadJobs() {
        try {
            const res = await fetch('/api/v1/jobs');
            if (res.ok) setJobs(await res.json());
        } catch {
            // Backend unreachable: search just finds nothing.
        }
    }

    const trimmedQuery = query.trim().toLowerCase();
    const results = !trimmedQuery || !jobs ? [] : jobs
        .filter((job) => job.status === 'done' || (job.images?.length ?? 0) > 0)
        .map((job) => {
            const isModel = job.status === 'done';
            return {
                id: job.id,
                isModel,
                name: jobDisplayName(job, isModel ? 'Model' : 'Photos'),
                kind: isModel ? '3D model' : `Source photos \u00b7 ${job.images.length}`,
            };
        })
        .filter((result) => result.name.toLowerCase().includes(trimmedQuery))
        .slice(0, MAX_SEARCH_RESULTS);

    function openResult(result) {
        setIsOpen(false);
        setQuery('');
        if (result.isModel) onOpenModel(result.id);
        else onOpenLibrary('photos');
        onResultOpened?.();
    }

    function handleKeyDown(event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (results.length === 0) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setHighlightedIndex((index) => (index + step + results.length) % results.length);
        } else if (event.key === 'Enter' && results[highlightedIndex]) {
            event.preventDefault();
            openResult(results[highlightedIndex]);
        }
    }

    return (
        <div className="app-search" ref={searchRef}>
            <Icon name="search" size={16} />
            <input
                type="search"
                autoFocus={autoFocus}
                value={query}
                placeholder="Search models and photos"
                aria-label="Search models and photos"
                role="combobox"
                aria-expanded={isOpen && Boolean(trimmedQuery)}
                aria-controls="app-search-results"
                onFocus={() => {
                    setIsOpen(true);
                    loadJobs();
                }}
                onChange={(event) => {
                    setQuery(event.target.value);
                    setHighlightedIndex(0);
                    setIsOpen(true);
                }}
                onKeyDown={handleKeyDown}
            />
            {isOpen && trimmedQuery && (
                <div className="app-menu app-search-results" id="app-search-results" role="listbox">
                    {results.length === 0 && (
                        <p className="app-menu-note">{jobs ? `No models or photos match "${query.trim()}".` : 'Loading\u2026'}</p>
                    )}
                    {results.map((result, index) => (
                        <button
                            key={result.id}
                            type="button"
                            role="option"
                            aria-selected={index === highlightedIndex}
                            className={index === highlightedIndex ? 'app-menu-item is-highlighted' : 'app-menu-item'}
                            onPointerEnter={() => setHighlightedIndex(index)}
                            onClick={() => openResult(result)}
                        >
                            <Icon name={result.isModel ? 'cube' : 'image'} size={16} />
                            <span>
                                <strong>{result.name}</strong>
                                <small>{result.kind}</small>
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function TopNav({
    user,
    isCompact = false,
    isBackToHome = false,
    onGoHome,
    onOpenModel,
    onOpenLibrary,
    onOpenSettings,
    onOpenFeedback,
    onOpenAccount,
    onShowWalkthrough,
    onSignOut,
}) {
    const [openPopup, setOpenPopup] = useState(null);
    // Phones: whether the search row under the bar is open.
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const searchRowRef = useRef(null);
    const notificationsRef = useRef(null);
    const profileRef = useRef(null);
    const profilePhoto = useProfilePhoto(user.email);
    const { isMuted } = useSoundSettings();
    const plan = currentPlan();
    const closePopup = () => setOpenPopup(null);
    useCloseOnOutsideClick(openPopup === 'notifications', notificationsRef, closePopup);
    useCloseOnOutsideClick(openPopup === 'profile', profileRef, closePopup);
    useCloseOnOutsideClick(isSearchOpen, searchRowRef, () => setIsSearchOpen(false));

    function togglePopup(name) {
        setOpenPopup((current) => (current === name ? null : name));
    }

    const avatar = profilePhoto ? <img src={profilePhoto} alt="" /> : initialsOf(user.name);

    return (
        <header className={isCompact ? 'app-topbar is-compact' : 'app-topbar'}>
            {isBackToHome ? (
                <button type="button" className="app-topbar-back" onClick={onGoHome}>
                    <Icon name="arrow" size={16} />
                    <span>Back to home</span>
                </button>
            ) : (
                <button type="button" className="app-topbar-logo" onClick={onGoHome} aria-label="GENESIS home">
                    <img src={genesisLogo} alt="" />
                    <span>GENESIS</span>
                </button>
            )}

            {!isCompact && <SearchBox onOpenModel={onOpenModel} onOpenLibrary={onOpenLibrary} />}

            <div className="app-topbar-actions">
                {isCompact ? (
                    <div className="app-popup-anchor" ref={searchRowRef}>
                        <button
                            type="button"
                            className="app-icon-button"
                            aria-label="Search"
                            aria-expanded={isSearchOpen}
                            onClick={() => {
                                setIsSearchOpen((isOpen) => !isOpen);
                            }}
                        >
                            <Icon name="search" size={20} />
                        </button>
                        {isSearchOpen && (
                            <div className="app-search-row">
                                <SearchBox
                                    autoFocus
                                    onOpenModel={onOpenModel}
                                    onOpenLibrary={onOpenLibrary}
                                    onResultOpened={() => setIsSearchOpen(false)}
                                />
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {/* Display only until the backend reports storage used. */}
                        <span className="app-storage-meter" title="Storage use coming soon">
                            {'\u2014'} / {plan.storage}
                        </span>

                        <button
                            type="button"
                            className="app-icon-button"
                            aria-label="Settings"
                            title="Settings"
                            onClick={() => {
                                onOpenSettings();
                            }}
                        >
                            <Icon name="settings" size={18} />
                        </button>
                    </>
                )}

                <div className="app-popup-anchor" ref={notificationsRef}>
                    <button
                        type="button"
                        className="app-icon-button"
                        aria-label="Notifications"
                        aria-expanded={openPopup === 'notifications'}
                        onClick={() => togglePopup('notifications')}
                    >
                        <Icon name="bell" size={18} />
                    </button>
                    {openPopup === 'notifications' && (
                        <div className="app-menu app-notifications" role="dialog" aria-label="Notifications">
                            <p className="app-menu-heading">Notifications</p>
                            <p className="app-menu-note">You're all caught up. Updates about your models will show here.</p>
                        </div>
                    )}
                </div>

                <div className="app-popup-anchor" ref={profileRef}>
                    <button
                        type="button"
                        className="app-avatar"
                        aria-label="Account menu"
                        aria-expanded={openPopup === 'profile'}
                        onClick={() => togglePopup('profile')}
                    >
                        {avatar}
                    </button>
                    {openPopup === 'profile' && (
                        <div className="app-menu app-profile-menu" role="dialog" aria-label="Account overview">
                            <div className="app-profile-summary">
                                <span className="app-avatar is-large">{avatar}</span>
                                <span>
                                    <strong>{user.name}</strong>
                                    <small>{user.email}</small>
                                </span>
                            </div>
                            {!user.isGuest && (
                                <button
                                    type="button"
                                    className="forma-btn app-profile-manage"
                                    onClick={() => {
                                        closePopup();
                                        onOpenAccount();
                                    }}
                                >
                                    <Icon name="user" size={15} /> Manage account
                                </button>
                            )}

                            <div className="app-profile-section">
                                <p className="app-menu-heading">Genesis</p>
                                <div className="app-profile-plan">
                                    <span className="app-plan-badge">{plan.id}</span>
                                    <strong>{plan.name}</strong>
                                </div>
                                <div className="app-profile-storage">
                                    <span>Cloud storage</span>
                                    <span>{'\u2014'} of {plan.storage}</span>
                                </div>
                                <div className="app-storage-bar" aria-hidden="true"><span style={{ width: '0%' }} /></div>
                                <small className="app-profile-storage-note">Storage use coming soon</small>
                            </div>

                            <div className="app-profile-section">
                                {!user.isGuest && (
                                    <button
                                        type="button"
                                        className="app-menu-item is-compact"
                                        onClick={() => {
                                            closePopup();
                                            onOpenFeedback();
                                        }}
                                    >
                                        <Icon name="message" size={16} />
                                        Send feedback
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="app-menu-item is-compact"
                                    onClick={() => {
                                        setSoundMuted(!isMuted);
                                        // Muting stays silent; unmuting plays once to confirm.
                                        if (isMuted) playSound('success');
                                    }}
                                >
                                    <Icon name={isMuted ? 'volume' : 'volumeOff'} size={16} />
                                    {isMuted ? 'Unmute sounds' : 'Mute sounds'}
                                </button>
                                {isCompact && onShowWalkthrough && (
                                    <button
                                        type="button"
                                        className="app-menu-item is-compact"
                                        onClick={() => {
                                            closePopup();
                                            onShowWalkthrough();
                                        }}
                                    >
                                        <Icon name="book" size={16} />
                                        Show walkthrough
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="app-menu-item is-compact"
                                    onClick={() => {
                                        closePopup();
                                        onSignOut();
                                    }}
                                >
                                    <Icon name={user.isGuest ? 'user' : 'logout'} size={16} />
                                    {user.isGuest ? 'Sign in' : 'Log out'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}

export default TopNav;