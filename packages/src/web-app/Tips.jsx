/*!************************************************************************
\file Tips.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 25-11-2026
\brief
First-run help on wider screens, as in the Figma, which replaces the
sidebar walkthrough there (phones keep Walkthrough.jsx):
- WelcomeCard: "Welcome to Genesis" in the bottom corner of Home, the
  first time an account signs in on this browser: Take the tour, or I'll
  explore.
- TipCard: one short tip beside the part of the page it is about. The
  tour is two of them (the Photo Editor, then the Scene Builder's Library
  tab), and the Video Extractor shows one the first time it opens.
The tips' words and places are in TipsContent.js.
**************************************************************************/

import { useLayoutEffect, useState } from 'react';
import { playSound } from '../audio/Audio.js';
import './Tips.css';

// Gap between a tip and what it sits beside, in pixels.
const TIP_GAP = 12;

// Where the tip goes, from its target's place on screen. Falls back to the
// middle of the page when the target isn't there.
function placeTip(target, placement) {
    const element = document.querySelector(target);
    if (!element) return { left: '50%', top: '40%', transform: 'translate(-50%, -50%)' };
    const rect = element.getBoundingClientRect();
    if (placement === 'right') return { left: rect.right + TIP_GAP, top: rect.top + 40 };
    if (placement === 'inside') return { left: rect.left + 16, top: rect.top + 16 };
    return { left: rect.left, top: rect.bottom + TIP_GAP };
}

export function TipCard({ tip, stepText, primaryLabel, onPrimary, secondaryLabel, onSecondary }) {
    const [position, setPosition] = useState(null);

    // Measured after the page has laid out, and again when the window resizes.
    useLayoutEffect(() => {
        function measure() {
            setPosition(placeTip(tip.target, tip.placement));
        }
        // The page may still be mounting its content; measure on the next frame.
        const frameId = requestAnimationFrame(measure);
        window.addEventListener('resize', measure);
        return () => {
            cancelAnimationFrame(frameId);
            window.removeEventListener('resize', measure);
        };
    }, [tip]);

    if (!position) return null;

    return (
        <div className="tip-card" role="dialog" aria-label={tip.title} style={position}>
            <h2>{tip.title}</h2>
            <p>{tip.text}</p>
            <div className="tip-card-actions">
                <button
                    type="button"
                    className="forma-btn forma-btn-primary"
                    onClick={() => {
                        playSound('confirm');
                        onPrimary();
                    }}
                >
                    {primaryLabel}
                </button>
                {secondaryLabel && (
                    <button
                        type="button"
                        className="forma-btn"
                        onClick={() => {
                            playSound('back');
                            onSecondary();
                        }}
                    >
                        {secondaryLabel}
                    </button>
                )}
                {stepText && <span className="tip-card-step">{stepText}</span>}
            </div>
        </div>
    );
}

export function WelcomeCard({ onTakeTour, onExplore }) {
    return (
        <div className="tip-card welcome-card" role="dialog" aria-label="Welcome to Genesis">
            <h2>Welcome to Genesis</h2>
            <p>Take a short tour of making your first model, or look around on your own. The tour stays in Learn.</p>
            <div className="tip-card-actions">
                <button
                    type="button"
                    className="forma-btn forma-btn-primary"
                    onClick={() => {
                        playSound('confirm');
                        onTakeTour();
                    }}
                >
                    Take the tour
                </button>
                <button
                    type="button"
                    className="forma-btn"
                    onClick={() => {
                        playSound('tap');
                        onExplore();
                    }}
                >
                    I&apos;ll explore
                </button>
            </div>
        </div>
    );
}