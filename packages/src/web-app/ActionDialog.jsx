/*!************************************************************************
\file ActionDialog.jsx
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 20-10-2026
\brief
Small modal used by the Media Library to rename (with a text field) or to
confirm a delete (without one). onConfirm may return a promise: the dialog
stays open and disabled until it settles, and shows its error message if
it rejects so the user can fix the name or cancel. Key presses are kept
inside the dialog, so typing doesn't reach window-level shortcuts such as
the splat viewer's.
- ActionDialog({ title, message, initialValue, placeholder, confirmLabel,
  cancelLabel, danger, onConfirm, onCancel })
Pass initialValue (a string) to show the text field.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { playSound } from '../audio/Audio.js';

function ActionDialog({
    title, message, initialValue, placeholder, confirmLabel, cancelLabel = 'Cancel', danger, onConfirm, onCancel,
}) {
    const hasInput = typeof initialValue === 'string';
    const [value, setValue] = useState(initialValue ?? '');
    const [error, setError] = useState(null);
    const [isBusy, setIsBusy] = useState(false);
    const inputRef = useRef(null);
    const confirmRef = useRef(null);

    useEffect(() => {
        if (hasInput) {
            inputRef.current.focus();
            inputRef.current.select();
        } else {
            confirmRef.current.focus();
        }
        // Only on open: re-selecting while the user types would fight them.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Every way of closing without confirming (button, Escape, backdrop).
    function cancelWithSound() {
        playSound('back');
        onCancel();
    }

    function handleKeyDown(event) {
        // Stop here so window listeners (the splat viewer's C/I/U/P toggles)
        // don't react to what the user types.
        event.stopPropagation();
        if (event.key === 'Escape' && !isBusy) cancelWithSound();
    }

    async function handleSubmit(event) {
        event.preventDefault();
        // Destructive actions (delete) get the "back" sound, others "confirm".
        playSound(danger ? 'back' : 'confirm');
        setIsBusy(true);
        setError(null);
        try {
            await onConfirm(value);
        } catch (err) {
            setError(err.message);
            setIsBusy(false);
        }
    }

    return createPortal(
        <div className="action-dialog-backdrop" onPointerDown={() => !isBusy && cancelWithSound()}>
            <form
                className="forma-card action-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="action-dialog-title"
                onSubmit={handleSubmit}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                <h3 id="action-dialog-title">{title}</h3>
                {message && <p className="action-dialog-message">{message}</p>}
                {hasInput && (
                    <input
                        ref={inputRef}
                        className="action-dialog-input"
                        value={value}
                        placeholder={placeholder}
                        disabled={isBusy}
                        onChange={(event) => setValue(event.target.value)}
                    />
                )}
                {error && <p className="action-dialog-error">{error}</p>}
                <div className="action-dialog-buttons">
                    <button type="button" className="forma-btn" disabled={isBusy} onClick={cancelWithSound}>
                        {cancelLabel}
                    </button>
                    <button
                        ref={confirmRef}
                        type="submit"
                        className={danger ? 'forma-btn forma-btn-danger' : 'forma-btn forma-btn-primary'}
                        disabled={isBusy}
                    >
                        {isBusy ? 'Working...' : confirmLabel}
                    </button>
                </div>
            </form>
        </div>,
        document.body
    );
}

export default ActionDialog;
