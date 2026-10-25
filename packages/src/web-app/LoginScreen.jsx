/*!************************************************************************
\file LoginScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Sign in / create account screen shown before the dashboard. Validates the
form shape (email format, 6+ character password, name when creating an
account), then posts it to the backend: /auth/signup creates the account
in the SQLite database (password stored only as a hash), /auth/login checks
the password. On success the user object the server returns is handed to
the parent, which keeps it as this browser's session. "Continue as guest"
skips the backend and hands the parent a local guest user instead.
Layout: a hero panel on the left (hidden on narrow screens) and the form
on the right. "Continue with Google" sends the browser to /auth/google once
the backend supports it (GOOGLE_SIGN_IN_READY); until then it says so.
**************************************************************************/

import { useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

// TODO(backend): set to true once GET /auth/google starts the Google sign-in
// and redirects back to the site with the session cookie set.
const GOOGLE_SIGN_IN_READY = false;
const GOOGLE_SIGN_IN_URL = '/auth/google';

// Short summary of the workflow shown on the hero panel.
const HERO_STEPS = ['Capture source photos', 'Generate detailed models', 'Build complete scenes'];

// Google's "G" logo, as required on a Google sign-in button.
function GoogleLogo({ size = 17 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M21.35 11.1h-9.18v3.71h5.28c-.23 1.2-.91 2.22-1.93 2.9v2.41h3.12c1.83-1.68 2.88-4.16 2.88-7.09 0-.67-.06-1.32-.17-1.93Z" />
            <path fill="#34A853" d="M12.17 21.5c2.62 0 4.82-.87 6.43-2.36l-3.12-2.41c-.87.58-1.98.92-3.31.92-2.53 0-4.67-1.71-5.44-4.01H3.51v2.49a9.7 9.7 0 0 0 8.66 5.37Z" />
            <path fill="#FBBC05" d="M6.73 13.64a5.83 5.83 0 0 1 0-3.73V7.42H3.51a9.72 9.72 0 0 0 0 8.71l3.22-2.49Z" />
            <path fill="#EA4335" d="M12.17 5.9c1.43 0 2.72.49 3.73 1.47l2.79-2.79C17 3.01 14.79 2.05 12.17 2.05a9.7 9.7 0 0 0-8.66 5.37l3.22 2.49c.77-2.3 2.91-4.01 5.44-4.01Z" />
        </svg>
    );
}

function LoginScreen({ onLogin }) {
    const [mode, setMode] = useState('signin');
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [errorMessage, setErrorMessage] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isSignUp = mode === 'signup';

    function switchMode() {
        playSound('tap');
        setMode(isSignUp ? 'signin' : 'signup');
        setErrorMessage(null);
    }

    // Leaves the page for Google's sign-in. The backend sends the browser back
    // to the site afterwards, where App's GET /auth/me picks up the session.
    function continueWithGoogle() {
        playSound('confirm');
        if (!GOOGLE_SIGN_IN_READY) {
            setErrorMessage('Google sign-in is coming soon. Please use your email for now.');
            return;
        }
        window.location.href = GOOGLE_SIGN_IN_URL;
    }

    // Temporary bypass: skips the backend and signs in as a local-only guest.
    // The backend does not check the session, so every feature still works.
    function continueAsGuest() {
        playSound('tap');
        onLogin({
            name: 'Guest',
            email: 'Not signed in',
            memberSince: new Date().toLocaleDateString('en-SG', { month: 'short', year: 'numeric' }),
            isGuest: true,
        });
    }

    async function handleSubmit(event) {
        event.preventDefault();
        const trimmedEmail = email.trim();

        if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
            setErrorMessage('Enter a valid email address.');
            return;
        }
        if (password.length < 6) {
            setErrorMessage('Password must be at least 6 characters.');
            return;
        }
        if (isSignUp && !displayName.trim()) {
            setErrorMessage('Enter your name.');
            return;
        }

        playSound('confirm');
        setErrorMessage(null);
        setIsSubmitting(true);

        try {
            const body = isSignUp
                ? { name: displayName.trim(), email: trimmedEmail, password, remember: rememberMe }
                : { email: trimmedEmail, password, remember: rememberMe };
            const res = await fetch(isSignUp ? '/auth/signup' : '/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            // The backend always answers JSON; fall back to {} if a proxy
            // or crash returned something else.
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                setErrorMessage(data.error || 'Something went wrong. Please try again.');
                return;
            }
            onLogin(data);
        } catch {
            setErrorMessage('Could not reach the server. Is the backend running?');
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div className="genesis-login genesis-login-split">
            <aside className="login-hero">
                <div className="forma-logo login-hero-logo">
                    <span className="forma-logo-icon"><Icon name="cube" size={18} /></span>
                    GENESIS
                </div>
                <div className="login-hero-copy">
                    <p className="eyebrow eyebrow-accent">Creative 3D workspace</p>
                    <h2>Shape ideas into worlds.</h2>
                    <p>
                        Turn source photos and video frames into polished 3D assets, then
                        refine and arrange them in one connected workspace.
                    </p>
                    <ul className="login-hero-steps">
                        {HERO_STEPS.map((step) => <li key={step}>{step}</li>)}
                    </ul>
                </div>
                <p className="login-hero-footer">Image to model - Model to scene</p>
            </aside>

            <div className="login-panel">
                <form className="login-card" onSubmit={handleSubmit}>
                    <div className="forma-logo login-logo">
                        <span className="forma-logo-icon"><Icon name="cube" size={18} /></span>
                        GENESIS
                    </div>
                    <p className="eyebrow">{isSignUp ? 'Create account' : 'Sign in'}</p>
                    <h1>{isSignUp ? 'Create your account' : 'Welcome back'}</h1>
                    <p className="login-subtitle">
                        Turn photos and video frames into polished 3D assets.
                    </p>

                    {isSignUp && (
                        <label className="login-field">
                            Name
                            <input
                                type="text"
                                value={displayName}
                                onChange={(event) => setDisplayName(event.target.value)}
                                autoComplete="name"
                            />
                        </label>
                    )}
                    <label className="login-field">
                        Email
                        <input
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            autoComplete="email"
                        />
                    </label>
                    <label className="login-field">
                        Password
                        <input
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete={isSignUp ? 'new-password' : 'current-password'}
                        />
                    </label>
                    <label className="login-remember">
                        <input
                            type="checkbox"
                            checked={rememberMe}
                            onChange={(event) => setRememberMe(event.target.checked)}
                        />
                        Remember me
                    </label>

                    {errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}

                    <button
                        type="submit"
                        className="forma-btn forma-btn-primary login-submit"
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
                    </button>

                    <div className="login-divider"><span>or continue with</span></div>

                    <button
                        type="button"
                        className="forma-btn login-submit login-google"
                        onClick={continueWithGoogle}
                        disabled={isSubmitting}
                    >
                        <GoogleLogo /> Continue with Google
                    </button>

                    <button
                        type="button"
                        className="forma-btn login-submit"
                        onClick={continueAsGuest}
                        disabled={isSubmitting}
                    >
                        Continue as guest
                    </button>

                    <button type="button" className="login-switch" onClick={switchMode}>
                        {isSignUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default LoginScreen;