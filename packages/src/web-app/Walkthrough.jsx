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
Recent section, then each dock item from left to right), with a tooltip
beside it: step count, title, a short line of text, and Skip / Next
(Finish on the last step). Escape skips. If a step's item is not on the
screen, its tooltip is shown in the middle of the page instead.
In the mobile view the dock shows five tabs at a time, so each step slides
the tabs to the five that hold its item, and finishing slides back to the
five that hold the current page.
App.jsx shows it the first time each account signs in on a browser, and
again when the user presses "Show walkthrough" (account page or account
menu). Guests can't save work, so their last step suggests signing in.
- WALKTHROUGH_STEPS
The steps: a CSS selector for the item to highlight, title, text (and
guestText if guests see different text), and whether the tooltip goes
above or below the item.
- Walkthrough({ isGuest, onClose })
React component. Calls onClose() when the user skips or finishes.
**************************************************************************/

import { useCallback, useEffect, useState } from 'react';
import { playSound } from '../audio/Audio.js';
import './Walkthrough.css';

const WALKTHROUGH_STEPS = [
    {
        target: '.home-recent-v2-header',
        title: 'Recent',
        text: 'Your recent work will appear here.',
        placement: 'below',
        padding: 14,
    },
    {
        target: '.genesis-dock [aria-label="New model"]',
        title: 'New model',
        text: 'Quickly get started with your camera.',
        placement: 'above',
    },
    {
        target: '.genesis-dock [aria-label="Add photos"]',
        title: 'Add photos',
        text: 'Already have your photos? Upload them here.',
        placement: 'above',
    },
    {
        target: '.genesis-dock [aria-label="Home"]',
        title: 'Home',
        text: 'Your personal workspace.',
        placement: 'above',
    },
    {
        target: '.genesis-dock [aria-label="Media Library"]',
        title: 'Media Library',
        text: 'Your models and uploaded photos are stored here.',
        placement: 'above',
    },
    {
        target: '.genesis-dock [aria-label="Photo Editor"]',
        title: 'Photo Editor',
        text: 'Edit your photos to get the best model quality.',
        placement: 'above',
    },
    {
        target: '.genesis-dock [aria-label="Scene Builder"]',
        title: 'Scene Builder',
        text: 'Arrange your models into a scene that matches your vision.',
        placement: 'above',
    },
    {
        target: '.genesis-dock [aria-label="Frame Extractor"]',
        title: 'Frame Extractor',
        text: 'Turn videos or animated GIFs of an object into a 3D model.',
        placement: 'above',
    },
    {
        target: '.genesis-dock [aria-label="Model Viewer"]',
        title: 'Model Viewer',
        text: 'Open and inspect your finished models, or a .ply file from your computer.',
        placement: 'above',
    },
    {
        target: '.genesis-dock [aria-label="Feedback"]',
        title: 'Feedback',
        text: 'Found a bug or have an idea? Tell us here.',
        placement: 'above',
    },
    {
        target: '.genesis-dock-avatar',
        title: 'Your account',
        text: 'Your profile, plan and sound settings. You can replay this walkthrough from here.',
        guestText: 'Sign in here to save your work, choose a plan and send feedback.',
        placement: 'above',
    },
];

// Space between the item and the spotlight's edge (unless a step sets its own).
const DEFAULT_PADDING = 6;
// Space between the spotlight and the tooltip.
const TOOLTIP_GAP = 14;
const TOOLTIP_WIDTH = 276;
// Closest the tooltip may come to the sides of the screen.
const SCREEN_MARGIN = 12;
// The mobile dock's tabs (Dock.jsx), five to a page.
const MOBILE_DOCK_SCROLLER = '.genesis-mdock-scroller';

// Mobile dock: slide its tabs to the five that hold tabElement. Instant, so
// the spotlight can be measured straight after.
function showMobileDockPageWith(tabElement) {
    const scroller = tabElement?.closest(MOBILE_DOCK_SCROLLER);
    if (!scroller || scroller.clientWidth === 0) return false;
    const page = Math.floor(tabElement.offsetLeft / scroller.clientWidth);
    scroller.scrollTo({ left: page * scroller.clientWidth, behavior: 'instant' });
    return true;
}

function Walkthrough({ isGuest = false, onClose }) {
    const [stepIndex, setStepIndex] = useState(0);
    // The highlighted item's position on screen, or null if it isn't there.
    const [targetRect, setTargetRect] = useState(null);

    const step = WALKTHROUGH_STEPS[stepIndex];
    const isLastStep = stepIndex === WALKTHROUGH_STEPS.length - 1;
    const padding = step.padding ?? DEFAULT_PADDING;
    const stepText = isGuest && step.guestText ? step.guestText : step.text;

    const finish = useCallback(() => {
        // Mobile dock: back to the tabs that hold the current page.
        showMobileDockPageWith(document.querySelector(`${MOBILE_DOCK_SCROLLER} [aria-current="page"]`));
        onClose();
    }, [onClose]);

    // Find the step's item (scrolling it into view if needed) and keep the
    // spotlight on it when the window is resized or the page scrolls.
    useEffect(() => {
        function measureTarget() {
            const targetElement = document.querySelector(step.target);
            if (!targetElement) {
                setTargetRect(null);
                return;
            }
            const rect = targetElement.getBoundingClientRect();
            setTargetRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
        }

        const targetElement = document.querySelector(step.target);
        // The mobile dock snaps to pages of five, which would undo scrollIntoView.
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
    }, [step.target]);

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

    if (targetRect) {
        spotlightStyle = {
            left: targetRect.left - padding,
            top: targetRect.top - padding,
            width: targetRect.width + padding * 2,
            height: targetRect.height + padding * 2,
            borderRadius: step.target.includes('dock') ? 999 : 14,
        };

        // Centred on the item, but kept inside the screen.
        const centredLeft = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        const left = Math.max(SCREEN_MARGIN, Math.min(window.innerWidth - tooltipWidth - SCREEN_MARGIN, centredLeft));
        tooltipStyle = step.placement === 'above'
            ? { left, width: tooltipWidth, bottom: window.innerHeight - (targetRect.top - padding - TOOLTIP_GAP) }
            : { left, width: tooltipWidth, top: targetRect.top + targetRect.height + padding + TOOLTIP_GAP };
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
                <span className="walkthrough-progress">{stepIndex + 1} / {WALKTHROUGH_STEPS.length}</span>
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