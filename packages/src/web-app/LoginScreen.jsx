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
**************************************************************************/

import { useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

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

        playSound('tap');
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
        <div className="genesis-login">
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
    );
}

export default LoginScreen;