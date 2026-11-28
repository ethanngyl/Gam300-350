/*!************************************************************************
\file OfflineNotice.jsx
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 28-11-2026
\brief
Tells the user when the browser loses its network connection, on every
screen (mounted once in main.jsx, outside the app's error boundary). While
offline a small notice at the bottom says so; when the connection comes
back it says "Back online." for a few seconds, then hides. It only follows
the browser's own online / offline state: a backend that is down while the
network is fine is reported by each page's "Couldn't reach the server".
- OfflineNotice()
React component. Renders nothing while online.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import './OfflineNotice.css';

// How long "Back online." stays up once the connection returns.
const BACK_ONLINE_MS = 3000;

function OfflineNotice() {
    // 'online' (nothing shown), 'offline', or 'back' (briefly, after reconnecting).
    const [state, setState] = useState(() => (navigator.onLine === false ? 'offline' : 'online'));
    const hideTimerRef = useRef(null);

    useEffect(() => {
        function handleOffline() {
            clearTimeout(hideTimerRef.current);
            setState('offline');
        }
        function handleOnline() {
            clearTimeout(hideTimerRef.current);
            // Only say "Back online" if the user was told they were offline.
            setState((current) => (current === 'offline' ? 'back' : 'online'));
            hideTimerRef.current = setTimeout(() => setState('online'), BACK_ONLINE_MS);
        }
        window.addEventListener('offline', handleOffline);
        window.addEventListener('online', handleOnline);
        return () => {
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('online', handleOnline);
            clearTimeout(hideTimerRef.current);
        };
    }, []);

    if (state === 'online') return null;

    const isOffline = state === 'offline';
    return (
        <div
            className={isOffline ? 'offline-notice is-offline' : 'offline-notice is-back'}
            role="status"
            aria-live="polite"
        >
            <span className="offline-notice-dot" aria-hidden="true" />
            {isOffline ? (
                <span>
                    <strong>You're offline.</strong> Check your internet connection. Pages that need
                    the server will work again once you're back online.
                </span>
            ) : (
                <strong>Back online.</strong>
            )}
        </div>
    );
}

export default OfflineNotice;
