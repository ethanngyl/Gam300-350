/*!************************************************************************
\file Walkthrough.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 02-11-2026
\brief
First-run walkthrough of the dashboard (Genesis design). The page is
dimmed and a glowing spotlight is drawn around one item at a time (each
page in the sidebar from top to bottom, or in the dock on phones, then the
profile), with a tooltip beside it, styled like the Genesis Figma: "Step 2
of 7" and "Skip tour", a bar with a segment per step, the title, a short
line of text, Back / Next (Finish on the last step), and an arrow pointing
at the item.
The tooltip goes to the right of sidebar items, under the top bar's and
above the dock's. Escape skips. If a step's item is not on the screen,
its tooltip is shown in the middle of the page instead; steps marked
optional are left out when their item isn't there (e.g. Learn on phones).
In the mobile view the dock shows four tabs at a time, so each step slides
the tabs to the four that hold its item, and finishing slides back to the
four that hold the current page.
App.jsx shows it from the welcome card's "Take the tour" (straight away
on phones, the first time each account signs in on a browser), and again
from Learn or "Show walkthrough". Guests can't save work, so their last step suggests signing in.
- WALKTHROUGH_STEPS
The steps: CSS selectors for the item to highlight (the first one on the
page is used: the sidebar's, else the dock's), title, text (and
mobileText / guestText where phones or guests see different text), and
optional for steps to leave out when their item isn't there.
- Walkthrough({ isGuest, onClose })
React component. Calls onClose() when the user skips or finishes.
**************************************************************************/

import { useCallback, useEffect, useState } from 'react';
import './Walkthrough.css';

// One step per page in the sidebar (or tab bar), then the profile.
const WALKTHROUGH_STEPS = [
    ...[
        ['Home', 'Home is your workspace', 'A customised space for you, with quick starts and your recent files.'],
        ['Media Library', 'Media Library keeps your work', 'Your 3D models and the photos they were built from, in one place.'],
        ['Photo Editor', 'Photo Editor checks your shots', 'Tidy up your photos and see which ones are blurry or repeated before you build.'],
        ['Scene Builder', 'Scene Builder stages your models', 'Arrange your models in a scene and set the light and the camera.'],
        ['Video Extractor', 'Video Extractor works from video', 'Upload a walkaround video and it pulls out sharp frames to build a model from.'],
        ['Model Viewer', 'Model Viewer shows the result', 'Open and inspect your finished models, or a .ply file from your computer.'],
    ].map(([label, title, text]) => ({
        targets: [`.app-sidebar [aria-label="${label}"]`, `.genesis-dock [aria-label="${label}"]`],
        title,
        text,
    })),
    {
        targets: ['.app-topbar .app-avatar'],
        title: 'Your profile',
        text: 'Your account, plan, storage and sounds. You can replay this tour from Learn.',
        mobileText: 'Your account, plan, storage and sounds. You can replay this tour from here.',
        guestText: 'Sign in here to save your work, choose a plan and send feedback.',
    },
];

// Space between the item and the spotlight's edge (unless a step sets its own).
const DEFAULT_PADDING = 6;
// Space between the spotlight and the tooltip.
const TOOLTIP_GAP = 14;
const TOOLTIP_WIDTH = 300;
// How far the arrow sits from the tooltip's top corner, as a rule.
const ARROW_INSET = 36;
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
                finish();
            }
        }
        window.addEventListener('keydown', skipOnEscape);
        return () => window.removeEventListener('keydown', skipOnEscape);
    }, [finish]);

    function goToNextStep() {
        if (isLastStep) {
            finish();
            return;
        }
        setStepIndex((index) => index + 1);
    }

    function goToPreviousStep() {
        if (stepIndex === 0) return;
        setStepIndex((index) => index - 1);
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
            // Beside the item, its top a little above the item's (kept on screen).
            const top = Math.max(SCREEN_MARGIN, Math.min(window.innerHeight - 220, target.top + target.height / 2 - ARROW_INSET));
            tooltipStyle = {
                left: target.left + target.width + padding + TOOLTIP_GAP,
                width: tooltipWidth,
                top,
                // The arrow points at the item's middle.
                '--walkthrough-arrow': `${target.top + target.height / 2 - top}px`,
            };
        } else {
            // Centred on the item, but kept inside the screen.
            const centredLeft = target.left + target.width / 2 - tooltipWidth / 2;
            const left = Math.max(SCREEN_MARGIN, Math.min(window.innerWidth - tooltipWidth - SCREEN_MARGIN, centredLeft));
            const arrow = `${Math.max(ARROW_INSET / 2, Math.min(tooltipWidth - ARROW_INSET / 2, target.left + target.width / 2 - left))}px`;
            tooltipStyle = target.placement === 'above'
                ? { left, width: tooltipWidth, bottom: window.innerHeight - (target.top - padding - TOOLTIP_GAP), '--walkthrough-arrow': arrow }
                : { left, width: tooltipWidth, top: target.top + target.height + padding + TOOLTIP_GAP, '--walkthrough-arrow': arrow };
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

            <div
                className={target ? `walkthrough-tooltip is-${target.placement}` : 'walkthrough-tooltip'}
                style={tooltipStyle}
                aria-live="polite"
            >
                <div className="walkthrough-head">
                    <span className="walkthrough-progress">Step {stepIndex + 1} of {steps.length}</span>
                    {!isLastStep && (
                        <button
                            type="button"
                            className="walkthrough-skip"
                            onClick={() => {
                                finish();
                            }}
                        >
                            Skip tour
                        </button>
                    )}
                </div>
                {/* One segment per step; the ones done so far are filled. */}
                <div className="walkthrough-segments" aria-hidden="true">
                    {steps.map((tourStep, index) => (
                        <span key={tourStep.title} className={index <= stepIndex ? 'is-done' : ''} />
                    ))}
                </div>
                <strong className="walkthrough-title">{step.title}</strong>
                <p className="walkthrough-text">{stepText}</p>
                <div className="walkthrough-actions">
                    <button
                        type="button"
                        className="walkthrough-back"
                        onClick={goToPreviousStep}
                        disabled={stepIndex === 0}
                    >
                        Back
                    </button>
                    <button type="button" className="walkthrough-next" onClick={goToNextStep}>
                        {isLastStep ? 'Finish' : 'Next'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default Walkthrough;