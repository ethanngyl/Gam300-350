/*!************************************************************************
\file ChangePasswordDialog.jsx
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
The account page's "Change password" modal: the current password, a new
one and the new one again. It looks and behaves like ActionDialog (same
classes, Escape / backdrop to cancel, key presses kept inside, disabled
while saving). Only "the two new passwords match" is checked here; every
other rule (length, not the same as before, the current password, the
attempt limit) is the server's, and its message is shown as it comes back.
Other browsers signed in to the account are signed out by the server; this
one stays signed in.
- ChangePasswordDialog({ onChanged, onCancel })
React component. onChanged() runs after the password has changed.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { playSound } from '../audio/Audio.js';

const CHANGE_PASSWORD_URL = '/api/v1/auth/me/password';

// What to tell the user for a reply that isn't a success.
async function errorMessage(res) {
    if (res.status === 401) return 'Your session has ended. Sign in again.';
    const data = await res.json().catch(() => ({}));
    return data.error || `Couldn't change the password (error ${res.status}).`;
}

function ChangePasswordDialog({ onChanged, onCancel }) {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState(null);
    const [isBusy, setIsBusy] = useState(false);
    const firstInputRef = useRef(null);

    useEffect(() => {
        firstInputRef.current.focus();
    }, []);

    // Every way of closing without saving (button, Escape, backdrop).
    function cancelWithSound() {
        playSound('back');
        onCancel();
    }

    function handleKeyDown(event) {
        // Stop here so window listeners (the splat viewer's shortcuts) don't
        // react to what the user types.
        event.stopPropagation();
        if (event.key === 'Escape' && !isBusy) cancelWithSound();
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!currentPassword || !newPassword || !confirmPassword) {
            playSound('back');
            setError('Fill in all three fields.');
            return;
        }
        if (newPassword !== confirmPassword) {
            playSound('back');
            setError('The new passwords don\'t match.');
            return;
        }

        playSound('confirm');
        setIsBusy(true);
        setError(null);
        try {
            const res = await fetch(CHANGE_PASSWORD_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            if (!res.ok) throw new Error(await errorMessage(res));
            onChanged();
        } catch (err) {
            // A network failure has no server message of its own.
            setError(err instanceof TypeError ? 'Couldn\'t reach the server. Try again.' : err.message);
            setIsBusy(false);
        }
    }

    return createPortal(
        <div className="action-dialog-backdrop" onPointerDown={() => !isBusy && cancelWithSound()}>
            <form
                className="forma-card action-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="change-password-title"
                onSubmit={handleSubmit}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                <h3 id="change-password-title">Change password</h3>
                <p className="action-dialog-message">
                    Other browsers signed in to your account will be signed out.
                </p>
                <label className="change-password-field">
                    Current password
                    <input
                        ref={firstInputRef}
                        className="action-dialog-input"
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        disabled={isBusy}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                </label>
                <label className="change-password-field">
                    New password
                    <input
                        className="action-dialog-input"
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        disabled={isBusy}
                        onChange={(event) => setNewPassword(event.target.value)}
                    />
                </label>
                <label className="change-password-field">
                    Confirm new password
                    <input
                        className="action-dialog-input"
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        disabled={isBusy}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                </label>
                {error && <p className="action-dialog-error" role="alert">{error}</p>}
                <div className="action-dialog-buttons">
                    <button type="button" className="forma-btn" disabled={isBusy} onClick={cancelWithSound}>
                        Cancel
                    </button>
                    <button type="submit" className="forma-btn forma-btn-primary" disabled={isBusy}>
                        {isBusy ? 'Working...' : 'Change password'}
                    </button>
                </div>
            </form>
        </div>,
        document.body
    );
}

export default ChangePasswordDialog;
