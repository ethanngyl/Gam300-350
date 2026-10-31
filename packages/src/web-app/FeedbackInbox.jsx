/*!************************************************************************
\file FeedbackInbox.jsx
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 31-10-2026
\brief
The admins' feedback Inbox, shown on the Feedback page's "Inbox" tab
(admins only). Read-only: lists the feedback stored in the VM's database
(GET /feedback, which answers 403 for anyone who isn't an admin), newest
first, 50 at a time with "Load more". A filter shows all feedback or one
kind (bug report, idea, other). Each message shows its kind, when it was
sent, the sender's name and email, and the machine it came from.
Messages are shown as plain text.
- FeedbackInbox()
React component.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';
import { FEEDBACK_CATEGORIES } from './FeedbackCategories.js';

const FILTERS = [{ id: null, label: 'All', icon: 'layers' }, ...FEEDBACK_CATEGORIES];

// "No bug reports yet" etc. for an empty list.
const EMPTY_TEXT = {
    bug: 'No bug reports yet.',
    idea: 'No ideas yet.',
    other: 'No other feedback yet.',
};

// Turns a failed GET /feedback into a message an admin can act on.
function describeLoadError(status) {
    if (status === 401) return 'Your session has ended. Sign in again to read feedback.';
    if (status === 403) return 'Only admins can read feedback.';
    if (status === 503) return "Couldn't reach the feedback service. Try again shortly.";
    return `Couldn't load feedback (server error ${status}). Please try again.`;
}

// One page of feedback: { items, hasMore }. Throws an Error with a
// readable message on failure.
async function fetchFeedbackPage(category, before) {
    const query = new URLSearchParams();
    if (category) query.set('category', category);
    if (before) query.set('before', String(before));
    let res;
    try {
        res = await fetch(`/feedback?${query}`);
    } catch {
        throw new Error("Couldn't reach the server. Check your connection and try again.");
    }
    if (!res.ok) throw new Error(describeLoadError(res.status));
    return res.json();
}

// "31 Oct 2026, 4:05 pm" in the viewer's own time zone.
function formatWhen(isoDate) {
    return new Date(isoDate).toLocaleString('en-SG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function FeedbackInbox() {
    const [filter, setFilter] = useState(null);
    const [items, setItems] = useState([]);
    const [hasMore, setHasMore] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [errorMessage, setErrorMessage] = useState(null);
    // Bumped on every new list load, so a slow answer for an older filter
    // can't replace a newer one.
    const requestRef = useRef(0);

    // Starts loading the first page for a filter; the list is replaced
    // when it arrives (unless a newer load has started since).
    function loadFirstPage(category) {
        const request = ++requestRef.current;
        fetchFeedbackPage(category, null).then(
            (page) => {
                if (request !== requestRef.current) return;
                setItems(page.items);
                setHasMore(page.hasMore);
                setErrorMessage(null);
                setIsLoading(false);
            },
            (err) => {
                if (request !== requestRef.current) return;
                setItems([]);
                setHasMore(false);
                setErrorMessage(err.message);
                setIsLoading(false);
            },
        );
    }

    // The first page, once, when the Inbox opens.
    useEffect(() => {
        loadFirstPage(null);
    }, []);

    function chooseFilter(category) {
        if (category === filter) return;
        playSound('tap');
        setFilter(category);
        setIsLoading(true);
        loadFirstPage(category);
    }

    function refresh() {
        playSound('tap');
        setIsLoading(true);
        loadFirstPage(filter);
    }

    async function loadMore() {
        playSound('tap');
        const request = requestRef.current;
        setIsLoadingMore(true);
        try {
            const page = await fetchFeedbackPage(filter, items[items.length - 1]?.id);
            if (request !== requestRef.current) return;
            setItems((current) => [...current, ...page.items]);
            setHasMore(page.hasMore);
        } catch (err) {
            if (request === requestRef.current) setErrorMessage(err.message);
        } finally {
            setIsLoadingMore(false);
        }
    }

    function renderList() {
        if (isLoading) return <p className="feedback-muted feedback-inbox-status">Loading feedback...</p>;
        if (errorMessage && items.length === 0) return null;
        if (items.length === 0) {
            return (
                <div className="feedback-inbox-empty">
                    <span className="feedback-state-icon"><Icon name="message" size={22} /></span>
                    <p className="feedback-muted">{EMPTY_TEXT[filter] ?? 'No feedback yet.'}</p>
                </div>
            );
        }
        return (
            <ul className="feedback-inbox-list">
                {items.map((item) => {
                    const kind = FEEDBACK_CATEGORIES.find((option) => option.id === item.category);
                    return (
                        <li key={item.id} className="feedback-inbox-item">
                            <div className="feedback-inbox-meta">
                                <span className={`feedback-inbox-kind is-${item.category}`}>
                                    <Icon name={kind?.icon ?? 'message'} size={13} />
                                    {kind?.label ?? item.category}
                                </span>
                                <time className="feedback-inbox-time" dateTime={item.createdAt}>
                                    {formatWhen(item.createdAt)}
                                </time>
                            </div>
                            <p className="feedback-inbox-message">{item.message}</p>
                            <div className="feedback-inbox-sender">
                                <strong>{item.name}</strong>
                                <span className="feedback-sender-email">{item.email}</span>
                                {item.origin && <span className="feedback-inbox-origin">from {item.origin}</span>}
                            </div>
                        </li>
                    );
                })}
            </ul>
        );
    }

    return (
        <section className="forma-card feedback-card feedback-inbox" aria-label="Feedback inbox">
            <div className="feedback-inbox-head">
                <div className="feedback-types feedback-inbox-filters" role="radiogroup" aria-label="Show">
                    {FILTERS.map((option) => (
                        <button
                            key={option.id ?? 'all'}
                            type="button"
                            role="radio"
                            aria-checked={filter === option.id}
                            className={filter === option.id ? 'feedback-type is-active' : 'feedback-type'}
                            onClick={() => chooseFilter(option.id)}
                        >
                            <Icon name={option.icon} size={15} />
                            <span>{option.label}</span>
                        </button>
                    ))}
                </div>
                <button type="button" className="forma-btn feedback-inbox-refresh" onClick={refresh} disabled={isLoading}>
                    <Icon name="refresh" size={14} /> Refresh
                </button>
            </div>

            {errorMessage && <p className="feedback-error" role="alert">{errorMessage}</p>}

            {renderList()}

            {hasMore && !isLoading && (
                <button type="button" className="forma-btn feedback-inbox-more" onClick={loadMore} disabled={isLoadingMore}>
                    {isLoadingMore ? 'Loading...' : 'Load more'}
                </button>
            )}
        </section>
    );
}

export default FeedbackInbox;
