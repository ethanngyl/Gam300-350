/*!************************************************************************
\file Walkthrough.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 02-11-2026
\brief
First-run walkthrough of the dashboard (Genesis design). The page is
dimmed and a glowing spotlight is drawn around one item at a time (Home's
Recent section, then each sidebar item from top to bottom, or each dock
item from left to right on phones), with a tooltip beside it: step count,
title, a short line of text, and Skip / Next (Finish on the last step).
The tooltip goes to the right of sidebar items, under the top bar's and
above the dock's. Escape skips. If a step's item is not on the screen,
its tooltip is shown in the middle of the page instead; steps marked
optional are left out when their item isn't there (e.g. Learn on phones).
In the mobile view the dock shows four tabs at a time, so each step slides
the tabs to the four that hold its item, and finishing slides back to the
four that hold the current page.
App.jsx shows it the first time each account signs in on a browser, and
again when the user presses "Show walkthrough" (account page or account
menu). Guests can't save work, so their last step suggests signing in.
- WALKTHROUGH_STEPS
The steps: CSS selectors for the item to highlight (the first one on the
page is used: the sidebar's, else the dock's), title, text (and
mobileText / guestText where phones or guests see different text), and
optional for steps to leave out when their item isn't there.
- Walkthrough({ isGuest, onClose })
React component. Calls onClose() when the user skips or finishes.
**************************************************************************/

import { useCallback, useEffect, useState } from 'react';
import { playSound } from '../audio/Audio.js';
import './Walkthrough.css';

const WALKTHROUGH_STEPS = [
    {
        targets: ['.home-recent-v2-header'],
        title: 'Recent',
        text: 'Your recent work will appear here.',
        padding: 14,
    },
    {
        targets: ['.app-sidebar [aria-label="New"]', '.genesis-dock [aria-label="Capture"]'],
        title: 'New model',
        text: 'Start a model with your camera, or upload photos you already have.',
        mobileText: 'Quickly get started with your camera.',
    },
    {
        targets: ['.genesis-dock [aria-label="Add photos"]'],
        title: 'Add photos',
        text: 'Already have your photos? Upload them here.',
        optional: true,
    },
    ...[
        ['Home', 'Your personal workspace.'],
        ['Media Library', 'Your models and uploaded photos are stored here.'],
        ['Photo Editor', 'Edit your photos to get the best model quality.'],
        ['Scene Builder', 'Arrange your models into a scene that matches your vision.'],
        ['Video Extractor', 'Turn videos or animated GIFs of an object into a 3D model.'],
        ['Model Viewer', 'Open and inspect your finished models, or a .ply file from your computer.'],
    ].map(([label, text]) => ({
        targets: [`.app-sidebar [aria-label="${label}"]`, `.genesis-dock [aria-label="${label}"]`],
        title: label,
        text,
    })),
    {
        targets: ['.app-sidebar [aria-label="Feedback"]', '.genesis-dock [aria-label="Feedback"]'],
        title: 'Feedback',
        text: 'Found a bug or have an idea? Tell us here.',
    },
    {
        targets: ['.app-sidebar [aria-label="Learn"]'],
        title: 'Learn',
        text: 'Replay this walkthrough any time from here.',
        optional: true,
    },
    {
        targets: ['.app-topbar .app-avatar'],
        title: 'Your account',
        text: 'Your profile, plan and sound settings.',
        mobileText: 'Your profile, plan and sound settings. You can replay this walkthrough from here.',
        guestText: 'Sign in here to save your work, choose a plan and send feedback.',
    },
];

// Space between the item and the spotlight's edge (unless a step sets its own).
const DEFAULT_PADDING = 6;
// Space between the spotlight and the tooltip.
const TOOLTIP_GAP = 14;
const TOOLTIP_WIDTH = 276;
// Closest the tooltip may come to the sides of the screen.
const SCREEN_MARGIN = 12;
// The mobile dock's tabs (Dock.jsx), four to a page.
const MOBILE_DOCK_SCROLLER = '.genesis-mdock-scroller';

// The step's item: the first of its selectors found on the page.
function findTarget(step) {
    for (const selector of step.targets) {
        const element = document.querySelector(selector);
        if (element) return element;
    }
    return null;
}

// Where the tooltip goes for an item: right of the sidebar, under the top
// bar, above the dock, and under anything else.
function placementFor(element) {
    if (element?.closest('.app-sidebar')) return 'right';
    if (element?.closest('.genesis-dock')) return 'above';
    return 'below';
}

// Mobile dock: slide its tabs to the four that hold tabElement. Instant, so
// the spotlight can be measured straight after.
function showMobileDockPageWith(tabElement) {
    const scroller = tabElement?.closest(MOBILE_DOCK_SCROLLER);
    if (!scroller || scroller.clientWidth === 0) return false;
    const page = Math.floor(tabElement.offsetLeft / scroller.clientWidth);
    scroller.scrollTo({ left: page * scroller.clientWidth, behavior: 'instant' });
    return true;
}

function Walkthrough({ isGuest = false, onClose }) {
    // The steps for this layout: optional ones whose item isn't on the page are left out.
    const [steps] = useState(() => WALKTHROUGH_STEPS.filter((step) => !step.optional || findTarget(step)));
    const [stepIndex, setStepIndex] = useState(0);
    // The highlighted item's position on screen and where its tooltip goes,
    // or null if it isn't there.
    const [target, setTarget] = useState(null);

    const step = steps[stepIndex];
    const isLastStep = stepIndex === steps.length - 1;
    const padding = step.padding ?? DEFAULT_PADDING;
    // Phones have the tab bar instead of the sidebar.
    const isPhoneLayout = target !== null && !document.querySelector('.app-sidebar');
    let stepText = step.text;
    if (isPhoneLayout && step.mobileText) stepText = step.mobileText;
    if (isGuest && step.guestText) stepText = step.guestText;

    const finish = useCallback(() => {
        // Mobile dock: back to the tabs that hold the current page.
        showMobileDockPageWith(document.querySelector(`${MOBILE_DOCK_SCROLLER} [aria-current="page"]`));
        onClose();
    }, [onClose]);

    // Find the step's item (scrolling it into view if needed) and keep the
    // spotlight on it when the window is resized or the page scrolls.
    useEffect(() => {
        function measureTarget() {
            const targetElement = findTarget(step);
            if (!targetElement) {
                setTarget(null);
                return;
            }
            const rect = targetElement.getBoundingClientRect();
            setTarget({
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                placement: placementFor(targetElement),
            });
        }

        const targetElement = findTarget(step);
        // The mobile dock snaps to pages of four, which would undo scrollIntoView.
        if (!showMobileDockPageWith(targetElement)) targetElement?.scrollIntoView({ block: 'nearest' });
        const frameId = requestAnimationFrame(measureTarget);
        window.addEventListener('resize', measureTarget);
        // true: also hear scrolling inside the page's own scroll area.
        window.addEventListener('scroll', measureTarget, true);

        return () => {
            cancelAnimationFrame(frameId);
            window.removeEventListener('resize', measureTarget);
            window.removeEventListener('scroll', measureTarget, true);
        };
    }, [step]);

    // Escape skips the walkthrough.
    useEffect(() => {
        function skipOnEscape(event) {
            if (event.key === 'Escape') {
                playSound('back');
                finish();
            }
        }
        window.addEventListener('keydown', skipOnEscape);
        return () => window.removeEventListener('keydown', skipOnEscape);
    }, [finish]);

    function goToNextStep() {
        if (isLastStep) {
            playSound('confirm');
            finish();
            return;
        }
        playSound('tap');
        setStepIndex((index) => index + 1);
    }

    // Spotlight: the item plus padding. Dock items are round, so it is too.
    let spotlightStyle = null;
    let tooltipStyle;
    const tooltipWidth = Math.min(TOOLTIP_WIDTH, window.innerWidth - SCREEN_MARGIN * 2);

    if (target) {
        spotlightStyle = {
            left: target.left - padding,
            top: target.top - padding,
            width: target.width + padding * 2,
            height: target.height + padding * 2,
            borderRadius: target.placement === 'above' ? 999 : 14,
        };

        if (target.placement === 'right') {
            // Beside the item, its top level with the item's (kept on screen).
            const top = Math.max(SCREEN_MARGIN, Math.min(window.innerHeight - 180, target.top - padding));
            tooltipStyle = { left: target.left + target.width + padding + TOOLTIP_GAP, width: tooltipWidth, top };
        } else {
            // Centred on the item, but kept inside the screen.
            const centredLeft = target.left + target.width / 2 - tooltipWidth / 2;
            const left = Math.max(SCREEN_MARGIN, Math.min(window.innerWidth - tooltipWidth - SCREEN_MARGIN, centredLeft));
            tooltipStyle = target.placement === 'above'
                ? { left, width: tooltipWidth, bottom: window.innerHeight - (target.top - padding - TOOLTIP_GAP) }
                : { left, width: tooltipWidth, top: target.top + target.height + padding + TOOLTIP_GAP };
        }
    } else {
        // Item not on screen: tooltip in the middle of the page.
        tooltipStyle = { left: '50%', top: '50%', width: tooltipWidth, transform: 'translate(-50%, -50%)' };
    }

    return (
        <div className="walkthrough" role="dialog" aria-modal="true" aria-label="Workspace walkthrough">
            {/* Blocks clicks on the page; dims it when there is no spotlight. */}
            <div className={spotlightStyle ? 'walkthrough-blocker' : 'walkthrough-blocker is-dimmed'} />
            {spotlightStyle && <div className="walkthrough-spotlight" style={spotlightStyle} />}

            <div className="walkthrough-tooltip" style={tooltipStyle} aria-live="polite">
                <span className="walkthrough-progress">{stepIndex + 1} / {steps.length}</span>
                <strong className="walkthrough-title">{step.title}</strong>
                <p className="walkthrough-text">{stepText}</p>
                <div className="walkthrough-actions">
                    {!isLastStep && (
                        <button
                            type="button"
                            className="walkthrough-skip"
                            onClick={() => {
                                playSound('back');
                                finish();
                            }}
                        >
                            Skip
                        </button>
                    )}
                    <button type="button" className="walkthrough-next" onClick={goToNextStep}>
                        {isLastStep ? 'Finish' : 'Next'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default Walkthrough;