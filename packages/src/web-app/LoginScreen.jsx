/*!************************************************************************
\file LoginScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Sign in / create account screen shown before the dashboard. This is a
front-end placeholder: it validates the form shape (email format, 6+
character password, name when creating an account) and hands a user
object to the parent, which stores it in this browser only. No password is
checked against a server; swap handleSubmit for a backend call when an
auth endpoint exists.
**************************************************************************/

import { useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function LoginScreen({ onLogin }) {
    const [mode, setMode] = useState('signin');
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState(null);

    const isSignUp = mode === 'signup';

    function switchMode() {
        playSound('click');
        setMode(isSignUp ? 'signin' : 'signup');
        setErrorMessage(null);
    }

    function handleSubmit(event) {
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

        playSound('click');
        onLogin({
            name: displayName.trim() || capitalize(trimmedEmail.split('@')[0]),
            email: trimmedEmail,
            memberSince: new Date().toLocaleDateString('en-SG', { month: 'short', year: 'numeric' }),
        });
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

                {errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}

                <button type="submit" className="forma-btn forma-btn-primary login-submit">
                    {isSignUp ? 'Create account' : 'Sign in'}
                </button>

                <button type="button" className="login-switch" onClick={switchMode}>
                    {isSignUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
                </button>

                <p className="login-note">
                    Demo sign-in: accounts are kept in this browser only and passwords are not verified.
                </p>
            </form>
        </div>
    );
}

export default LoginScreen;