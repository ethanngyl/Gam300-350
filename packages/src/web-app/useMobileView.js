/*!************************************************************************
\file useMobileView.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
Whether the window is in the mobile view (760px wide or less). The app
shows the sidebar and top bar above that width, and the phone dock
(Dock.jsx) at or below it.
- MOBILE_QUERY
The media query for the mobile view (the CSS uses the same 760px).
- useMobileView()
React hook: true in the mobile view, re-rendering when the window crosses
the width.
**************************************************************************/

import { useSyncExternalStore } from 'react';

export const MOBILE_QUERY = '(max-width: 760px)';

function subscribeToMobileView(onChange) {
    const query = window.matchMedia?.(MOBILE_QUERY);
    query?.addEventListener('change', onChange);
    return () => query?.removeEventListener('change', onChange);
}

function isMobileView() {
    return window.matchMedia?.(MOBILE_QUERY).matches ?? false;
}

export function useMobileView() {
    return useSyncExternalStore(subscribeToMobileView, isMobileView);
}