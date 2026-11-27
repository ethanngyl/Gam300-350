/*!************************************************************************
\file pageLoadTiming.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 07-11-2026
\brief
Reports how long this page took to load, once per page load, so the
backend can work out p50 / p95 / p99 load times (GET
/api/v1/metrics/performance, admins). Imported once by main.jsx; runs by
itself. The numbers come from the browser's Navigation Timing, in ms from
the start of the navigation:
  ttfb             -- the first byte of the page arrived
  fcp              -- the first text or image was drawn
  domContentLoaded -- the HTML was parsed and its scripts had run
  load             -- everything (scripts, styles, images) had loaded
They are sent with navigator.sendBeacon, which never holds the page up;
browsers without these APIs send nothing, and a failed send is ignored.
**************************************************************************/

const PAGE_LOAD_URL = '/api/v1/metrics/page-load';

// ms rounded to 0.1, or undefined for a measure the browser didn't record.
function roundMs(value) {
    return typeof value === 'number' && value > 0 ? Math.round(value * 10) / 10 : undefined;
}

function sendPageLoadTiming() {
    try {
        const navigation = performance.getEntriesByType('navigation')[0];
        if (!navigation) return;
        const firstPaint = performance.getEntriesByName('first-contentful-paint')[0];
        const timing = {
            ttfb: roundMs(navigation.responseStart - navigation.startTime),
            fcp: roundMs(firstPaint?.startTime),
            domContentLoaded: roundMs(navigation.domContentLoadedEventEnd),
            load: roundMs(navigation.loadEventEnd),
        };
        const body = JSON.stringify(timing);
        if (body === '{}') return;

        const blob = new Blob([body], { type: 'application/json' });
        if (!navigator.sendBeacon?.(PAGE_LOAD_URL, blob)) {
            fetch(PAGE_LOAD_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
                .catch(() => {});
        }
    } catch {
        // Measuring must never break the page.
    }
}

// loadEventEnd is only set once the load event's handlers have finished,
// so wait one more turn after it.
if (typeof window !== 'undefined' && typeof performance !== 'undefined') {
    if (document.readyState === 'complete') {
        setTimeout(sendPageLoadTiming, 0);
    } else {
        window.addEventListener('load', () => setTimeout(sendPageLoadTiming, 0), { once: true });
    }
}
