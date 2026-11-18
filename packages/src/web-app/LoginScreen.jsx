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
"Forgot password?" switches the card to two more steps: the email
(/auth/forgot-password emails a 6-digit code), then the code and a new
password (/auth/reset-password), after which the card goes back to Sign in.
**************************************************************************/

import { useEffect, useState } from 'react';
import genesisLogo from './GenesisLogo.svg';
import { playSound } from '../audio/Audio.js';

// TODO(backend): set to true once GET /auth/google starts the Google sign-in
// and redirects back to the site with the session cookie set.
const GOOGLE_SIGN_IN_READY = true;
// Relative, so no server address is written into the frontend: the VM starts
// Google sign-in itself, and other machines' backends send the browser on to
// the VM (VM_AUTH_URL in the backend's .env).
const GOOGLE_SIGN_IN_URL = '/api/v1/auth/google';

// "Forgot password?": ask for an emailed code, then use it with a new password.
const FORGOT_PASSWORD_URL = '/api/v1/auth/forgot-password';
const RESET_PASSWORD_URL = '/api/v1/auth/reset-password';
// The server allows one code request per email per minute.
const RESEND_AFTER_MS = 60 * 1000;
const MIN_PASSWORD_LENGTH = 6;

// Posts JSON to the backend; returns { ok, data } (data is {} if the reply
// wasn't JSON, e.g. from a proxy).
async function postJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
}

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
    // A success message (code sent, password changed).
    const [notice, setNotice] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    // "Forgot password?" steps: mode 'forgot' (email) then 'reset' (code + new password).
    const [resetCode, setResetCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [canResend, setCanResend] = useState(false);

    const isSignUp = mode === 'signup';
    const isForgot = mode === 'forgot';
    const isReset = mode === 'reset';
    const isPasswordReset = isForgot || isReset;

    // "Resend code" becomes available a minute after a code was sent.
    useEffect(() => {
        if (!isReset || canResend) return undefined;
        const timer = setTimeout(() => setCanResend(true), RESEND_AFTER_MS);
        return () => clearTimeout(timer);
    }, [isReset, canResend]);

    function switchMode() {
        playSound('tap');
        setMode(isSignUp ? 'signin' : 'signup');
        setErrorMessage(null);
        setNotice(null);
    }

    function backToSignIn() {
        playSound('back');
        setMode('signin');
        setErrorMessage(null);
        setNotice(null);
        setResetCode('');
        setNewPassword('');
        setConfirmPassword('');
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

    // Step 1 of "Forgot password?": ask for the email (kept if already typed).
    function handleForgotPassword() {
        playSound('tap');
        setMode('forgot');
        setErrorMessage(null);
        setNotice(null);
    }

    // Emails a code (the reply is the same whether or not the account
    // exists), then moves on to step 2. Also used by "Resend code".
    async function requestResetCode() {
        const trimmedEmail = email.trim();
        if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
            setErrorMessage('Enter a valid email address.');
            return;
        }
        setErrorMessage(null);
        setIsSubmitting(true);
        try {
            const { ok, data } = await postJson(FORGOT_PASSWORD_URL, { email: trimmedEmail });
            if (!ok) {
                setErrorMessage(data.error || 'Something went wrong. Please try again.');
                return;
            }
            setNotice(data.message || 'If an account exists for that email, we\'ve sent it a code.');
            setMode('reset');
            setCanResend(false);
        } catch {
            setErrorMessage('Could not reach the server. Is the backend running?');
        } finally {
            setIsSubmitting(false);
        }
    }

    // Step 2: the code from the email and the new password.
    async function submitNewPassword() {
        if (!/^\d{6}$/.test(resetCode.trim())) {
            setErrorMessage('Enter the 6-digit code from the email.');
            return;
        }
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            setErrorMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
            return;
        }
        if (newPassword !== confirmPassword) {
            setErrorMessage('The two new passwords don\'t match.');
            return;
        }
        setErrorMessage(null);
        setIsSubmitting(true);
        try {
            const { ok, data } = await postJson(RESET_PASSWORD_URL, {
                email: email.trim(),
                code: resetCode.trim(),
                newPassword,
            });
            if (!ok) {
                setErrorMessage(data.error || 'Something went wrong. Please try again.');
                return;
            }
            // Back to Sign in, with the email still filled in.
            setMode('signin');
            setNotice(data.message || 'Password changed. Sign in with your new password.');
            setPassword('');
            setResetCode('');
            setNewPassword('');
            setConfirmPassword('');
        } catch {
            setErrorMessage('Could not reach the server. Is the backend running?');
        } finally {
            setIsSubmitting(false);
        }
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
        if (isForgot || isReset) {
            playSound('confirm');
            if (isForgot) await requestResetCode();
            else await submitNewPassword();
            return;
        }
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
        setNotice(null);
        setIsSubmitting(true);

        try {
            const body = isSignUp
                ? { name: displayName.trim(), email: trimmedEmail, password, remember: rememberMe }
                : { email: trimmedEmail, password, remember: rememberMe };
            const res = await fetch(isSignUp ? '/api/v1/auth/signup' : '/api/v1/auth/login', {
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
                    <span className="forma-logo-icon"><img src={genesisLogo} alt="" /></span>
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
                        <span className="forma-logo-icon"><img src={genesisLogo} alt="" /></span>
                        GENESIS
                    </div>
                    <p className="eyebrow">{isSignUp ? 'Create account' : isPasswordReset ? 'Forgot password' : 'Sign in'}</p>
                    <h1>
                        {isSignUp ? 'Create your account'
                            : isForgot ? 'Reset your password'
                                : isReset ? 'Enter your code'
                                    : 'Welcome to Genesis'}
                    </h1>
                    {isForgot && (
                        <p className="login-note">
                            Enter your account&apos;s email and we&apos;ll send you a 6-digit code to set a new password.
                        </p>
                    )}

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
                    {isReset && (
                        <>
                            <label className="login-field">
                                6-digit code
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={resetCode}
                                    onChange={(event) => setResetCode(event.target.value.replace(/\D/g, ''))}
                                    autoComplete="one-time-code"
                                />
                            </label>
                            <label className="login-field">
                                New password
                                <input
                                    type="password"
                                    value={newPassword}
                                    onChange={(event) => setNewPassword(event.target.value)}
                                    autoComplete="new-password"
                                />
                            </label>
                            <label className="login-field">
                                Confirm new password
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(event) => setConfirmPassword(event.target.value)}
                                    autoComplete="new-password"
                                />
                            </label>
                        </>
                    )}
                    {!isPasswordReset && (
                        <>
                            <div className="login-password">
                                <label className="login-field">
                                    Password
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        autoComplete={isSignUp ? 'new-password' : 'current-password'}
                                    />
                                </label>
                                {!isSignUp && (
                                    <button type="button" className="login-forgot" onClick={handleForgotPassword}>
                                        Forgot password?
                                    </button>
                                )}
                            </div>
                            <label className="login-remember">
                                <input
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(event) => setRememberMe(event.target.checked)}
                                />
                                Remember me
                            </label>
                        </>
                    )}

                    {notice && <p className="login-success" role="status">{notice}</p>}
                    {errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}

                    <button
                        type="submit"
                        className="forma-btn forma-btn-primary login-submit"
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? 'Please wait…'
                            : isSignUp ? 'Create account'
                                : isForgot ? 'Send code'
                                    : isReset ? 'Change password'
                                        : 'Sign in'}
                    </button>

                    {isPasswordReset && (
                        <div className="login-reset-links">
                            {isReset && (
                                <button
                                    type="button"
                                    className="login-switch"
                                    onClick={() => { playSound('tap'); requestResetCode(); }}
                                    disabled={!canResend || isSubmitting}
                                    title={canResend ? 'Email a new code' : 'You can ask for a new code a minute after the last one'}
                                >
                                    Resend code
                                </button>
                            )}
                            <button type="button" className="login-switch" onClick={backToSignIn}>
                                Back to sign in
                            </button>
                        </div>
                    )}

                    {!isPasswordReset && (
                        <>
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
                        </>
                    )}
                </form>
            </div>
        </div>
    );
}

export default LoginScreen;