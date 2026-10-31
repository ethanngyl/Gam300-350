/*!************************************************************************
\file FeedbackScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 31-10-2026
\brief
Feedback page, opened from the dock. Signed-in users pick what kind of
feedback it is (bug report, idea or other), write a message and send it
to the backend, which stores it in the database (POST /feedback with
{ category, message } as JSON; the session cookie says who sent it).
Guests are locked out: they see a card asking them to sign in instead of
the form, and the server refuses guests too (401).
After sending, the form is replaced by a thank-you card with "Send more
feedback". A side card lists what makes feedback useful. Layout: one
column on phones; on wider screens the tips sit beside the form.
- FEEDBACK_CATEGORIES
Kinds of feedback, with the placeholder text shown for each.
- FeedbackScreen({ user, onSignIn })
React component. onSignIn takes a guest back to the login screen.
**************************************************************************/

import { useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';
import './FeedbackScreen.css';

const FEEDBACK_CATEGORIES = [
    {
        id: 'bug',
        label: 'Bug report',
        icon: 'triangle',
        placeholder: 'What did you do, what did you expect, and what happened instead?',
    },
    {
        id: 'idea',
        label: 'Idea',
        icon: 'sparkle',
        placeholder: 'What would you like GENESIS to do, and what problem would it solve?',
    },
    {
        id: 'other',
        label: 'Other',
        icon: 'message',
        placeholder: 'Tell us what you think of GENESIS.',
    },
];

const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 1000;

// Turns a failed POST /feedback into a message the user can act on.
function describeSendError(status) {
    if (status === 401) return 'Your session has ended. Sign in again to send feedback.';
    if (status === 404) return 'Feedback is not set up on the server yet. Please try again later.';
    if (status === 413) return `Your message is too long. Keep it under ${MAX_MESSAGE_LENGTH} characters.`;
    return `Could not send your feedback (server error ${status}). Please try again.`;
}

function FeedbackScreen({ user, onSignIn }) {
    const [category, setCategory] = useState('idea');
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [errorMessage, setErrorMessage] = useState(null);
    const [isSent, setIsSent] = useState(false);

    const selectedCategory = FEEDBACK_CATEGORIES.find((option) => option.id === category);
    const trimmedLength = message.trim().length;
    const canSend = trimmedLength >= MIN_MESSAGE_LENGTH && !isSending;

    async function handleSubmit(event) {
        event.preventDefault();
        if (!canSend) return;

        playSound('confirm');
        setIsSending(true);
        setErrorMessage(null);
        try {
            const res = await fetch('/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category, message: message.trim() }),
            });
            if (!res.ok) {
                setErrorMessage(describeSendError(res.status));
                return;
            }
            setIsSent(true);
            setMessage('');
        } catch {
            setErrorMessage('Could not reach the server. Check your connection and try again.');
        } finally {
            setIsSending(false);
        }
    }

    function renderLockedCard() {
        return (
            <div className="forma-card feedback-card feedback-locked">
                <span className="feedback-state-icon"><Icon name="lock" size={22} /></span>
                <h2 className="feedback-card-title">Sign in to send feedback</h2>
                <p className="feedback-muted">
                    Feedback is linked to your account so the team can follow up with you.
                    Guests can look around, but only registered accounts can send feedback.
                </p>
                <button
                    className="forma-btn forma-btn-primary feedback-action"
                    onClick={() => {
                        playSound('tap');
                        onSignIn();
                    }}
                >
                    <Icon name="user" size={15} /> Sign in or create an account
                </button>
            </div>
        );
    }

    function renderSentCard() {
        return (
            <div className="forma-card feedback-card feedback-sent" role="status">
                <span className="feedback-state-icon is-success"><Icon name="check" size={22} /></span>
                <h2 className="feedback-card-title">Thanks for your feedback</h2>
                <p className="feedback-muted">
                    It has been sent to the GENESIS team. We read every message, and we may
                    contact you at {user.email} if we have questions.
                </p>
                <button
                    className="forma-btn feedback-action"
                    onClick={() => {
                        playSound('tap');
                        setIsSent(false);
                    }}
                >
                    Send more feedback
                </button>
            </div>
        );
    }

    function renderForm() {
        return (
            <form className="forma-card feedback-card feedback-form" onSubmit={handleSubmit}>
                <div className="feedback-field">
                    <span className="eyebrow feedback-label" id="feedback-type-label">Type</span>
                    <div className="feedback-types" role="radiogroup" aria-labelledby="feedback-type-label">
                        {FEEDBACK_CATEGORIES.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                role="radio"
                                aria-checked={category === option.id}
                                className={category === option.id ? 'feedback-type is-active' : 'feedback-type'}
                                onClick={() => {
                                    playSound('tap');
                                    setCategory(option.id);
                                }}
                            >
                                <Icon name={option.icon} size={15} />
                                <span>{option.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="feedback-field">
                    <label className="eyebrow feedback-label" htmlFor="feedback-message">Your feedback</label>
                    <textarea
                        id="feedback-message"
                        className="feedback-textarea"
                        rows={7}
                        maxLength={MAX_MESSAGE_LENGTH}
                        placeholder={selectedCategory.placeholder}
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        disabled={isSending}
                    />
                    <div className="feedback-counter">
                        <span>
                            {trimmedLength > 0 && trimmedLength < MIN_MESSAGE_LENGTH
                                ? `At least ${MIN_MESSAGE_LENGTH} characters`
                                : ''}
                        </span>
                        <span>{message.length} / {MAX_MESSAGE_LENGTH}</span>
                    </div>
                </div>

                {errorMessage && <p className="feedback-error" role="alert">{errorMessage}</p>}

                <div className="feedback-footer">
                    <span className="feedback-sender">
                        Sending as <strong>{user.name}</strong>
                        <span className="feedback-sender-email">{user.email}</span>
                    </span>
                    <button type="submit" className="forma-btn forma-btn-primary feedback-submit" disabled={!canSend}>
                        <Icon name="send" size={15} /> {isSending ? 'Sending...' : 'Send feedback'}
                    </button>
                </div>
            </form>
        );
    }

    let mainCard = renderForm();
    if (user.isGuest) mainCard = renderLockedCard();
    else if (isSent) mainCard = renderSentCard();

    return (
        <div className="feedback-screen">
            <div className="feedback-heading">
                <div className="eyebrow eyebrow-accent">Feedback</div>
                <h1 className="feedback-title">Help us improve GENESIS</h1>
                <p className="feedback-subtitle">
                    Found a bug or have an idea? Tell us what works, what doesn&apos;t, and what
                    you&apos;d like to see next.
                </p>
            </div>

            <div className="feedback-layout">
                {mainCard}

                <aside className="forma-card feedback-tips">
                    <h2 className="feedback-tips-title">What helps us most</h2>
                    <ul className="feedback-tips-list">
                        <li>
                            <Icon name="triangle" size={14} />
                            <span>For bugs: what you did, what you expected, and what happened instead.</span>
                        </li>
                        <li>
                            <Icon name="eye" size={14} />
                            <span>Which page you were on, and whether you were on a phone or a computer.</span>
                        </li>
                        <li>
                            <Icon name="sparkle" size={14} />
                            <span>For ideas: the problem it would solve for you.</span>
                        </li>
                    </ul>
                    <p className="feedback-tips-note">
                        Your name and email are sent with your feedback so we can reply.
                    </p>
                </aside>
            </div>
        </div>
    );
}

export default FeedbackScreen;