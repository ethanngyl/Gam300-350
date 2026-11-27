/*!************************************************************************
\file LandingScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 25-11-2026
\brief
The landing page signed-out visitors see first, laid out like the Figma's
"Landing page - Glass". Top to bottom:
- a floating glass bar: the logo, Product, How it works, Plans, Log in and
  Get started;
- the headline on black, with a model render behind three glass cards
  (a finished model, one ready for a scene, one still building);
- a light panel: the six things you can do in the workspace, beside a
  screenshot of the Media Library with a build's progress over it;
- a dark panel: the three steps from photos to a model, beside a tilted
  screenshot of Home with a "model is ready" note;
- a light panel: Plans (plans.js), with a Monthly / Annual switch;
- a dark panel: the closing call to action;
- the footer.
"Log in" opens the login screen; "Get started" opens it in create-account
mode. The pictures are our own (landing/): screenshots of the real app
and renders of the cat statue sample model. The panels keep their own
light and dark colours in both themes, as in the design.
- LandingScreen({ onLogIn, onGetStarted })
React component.
**************************************************************************/

import { useState } from 'react';
import Icon from './Icons.jsx';
import genesisLogo from './GenesisLogo.svg';
import { PLANS } from './plans.js';
import mediaLibraryScreenshot from './landing/app-media-library.webp';
import homeScreenshot from './landing/app-home.webp';
import catFrontImage from './landing/cat-front.webp';
import catSideImage from './landing/cat-side.webp';
import catTurnedImage from './landing/cat-turned.webp';
import './LandingScreen.css';

const NAV_LINKS = [
    { id: 'product', label: 'Product' },
    { id: 'how-it-works', label: 'How it works' },
    { id: 'plans', label: 'Plans' },
];

// The glass cards over the hero's render. progress: how far a build is (0-1).
const HERO_CARDS = [
    { name: 'Cat statue', detail: 'Built from 48 photos', image: catFrontImage },
    { name: 'Cat statue side scan', detail: 'Ready to place in a scene', image: catSideImage },
    { name: 'Cat statue (turned)', detail: 'Building model', image: catTurnedImage, progress: 0.53 },
];

const FEATURES = [
    { title: 'Add photos', text: 'Drop in an overlapping set from any camera.' },
    { title: 'Frames from video', text: 'Pull sharp, overlapping frames from a walkaround.' },
    { title: 'Photo editor', text: 'Blurry and duplicate shots are flagged before you build.' },
    { title: 'Media library', text: 'Source photos stay linked to the model they built.' },
    { title: 'Scene builder', text: 'Arrange models, set the light and the camera.' },
    { title: 'Export a model', text: 'Download it as a .ply or .obj file for other 3D tools.' },
];

// The build progress shown over the Media Library screenshot.
const BUILD_STEPS = [
    { label: 'Photos checked', value: '52 / 52', state: 'is-done' },
    { label: 'Cameras aligned', value: '52 / 52', state: 'is-done' },
    { label: 'Building model', value: '58%', state: 'is-active', progress: 0.58 },
    { label: 'Ready to view', value: '\u2013', state: 'is-pending' },
];

const STEPS = [
    {
        title: 'You shoot the object',
        text: 'Send in at least 8 photographs from different angles to render your ideal model.',
    },
    {
        title: 'Genesis does the maths',
        text: 'Every shot is aligned in 3D, then rebuilt as a model in the cloud.',
    },
    {
        title: 'You get a real model',
        text: 'View it, clean it up, drop it into a scene or export it.',
    },
];

// The picture at the top of each plan's card.
const PLAN_IMAGES = { free: catTurnedImage, pro: catFrontImage, max: catSideImage };

function scrollToSection(sectionId) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// A pill button with a round arrow badge on its right, as in the design.
// tone: 'pink' or 'dark'.
function PillButton({ tone = 'pink', isWide = false, onClick, children }) {
    return (
        <button
            type="button"
            className={`landing-pill is-${tone}${isWide ? ' is-wide' : ''}`}
            onClick={onClick}
        >
            <span>{children}</span>
            <span className="landing-pill-badge" aria-hidden="true">
                {/* An arrow up over a short line, as in the design. */}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 10V2.5M3.8 5.7 7 2.5l3.2 3.2M3 12.2h8" />
                </svg>
            </span>
        </button>
    );
}

function LandingScreen({ onLogIn, onGetStarted }) {
    const [billing, setBilling] = useState('monthly');

    function logIn() {
        onLogIn();
    }

    function getStarted() {
        onGetStarted();
    }

    const logo = (
        <span className="landing-logo">
            <img src={genesisLogo} alt="" />
            GENESIS
        </span>
    );

    return (
        <div className="landing-page">
            <header className="landing-nav">
                {logo}
                <nav className="landing-nav-links" aria-label="Sections">
                    {NAV_LINKS.map((link) => (
                        <button key={link.id} type="button" onClick={() => scrollToSection(link.id)}>
                            {link.label}
                        </button>
                    ))}
                    <button type="button" onClick={logIn}>Log in</button>
                </nav>
                <PillButton onClick={getStarted}>Get started</PillButton>
            </header>

            <main>
                <section className="landing-container landing-hero">
                    <div className="landing-hero-copy">
                        <h1>Build 3D<br />models from<br />photos.</h1>
                        <p>
                            Upload 40 to 80 photos of an object, or a walkaround video. Genesis turns them
                            into a 3D model you can edit, stage and export in your browser.
                        </p>
                        <div className="landing-actions">
                            <PillButton onClick={getStarted}>Get started free</PillButton>
                            <button type="button" className="landing-pill is-outline" onClick={logIn}>Log in</button>
                        </div>
                    </div>

                    <div className="landing-hero-visual" aria-hidden="true">
                        <img className="landing-hero-render" src={catFrontImage} alt="" />
                        <ul className="landing-hero-cards">
                            {HERO_CARDS.map((card) => (
                                <li key={card.name} className="landing-glass landing-hero-card">
                                    <img src={card.image} alt="" />
                                    <span>
                                        <strong>{card.name}</strong>
                                        <small>{card.detail}</small>
                                        {card.progress !== undefined && (
                                            <span className="landing-bar">
                                                <span style={{ width: `${card.progress * 100}%` }} />
                                            </span>
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>

                <section className="landing-panel is-light" id="product">
                    <div className="landing-container landing-split">
                        <div className="landing-split-copy">
                            <h2>Check, build, stage and export in one workspace.</h2>
                            <p className="landing-lead">These are the screens you use once you log in.</p>
                            <ul className="landing-features">
                                {FEATURES.map((feature) => (
                                    <li key={feature.title}>
                                        <h3>{feature.title}</h3>
                                        <p>{feature.text}</p>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="landing-shot-frame">
                            <img
                                src={mediaLibraryScreenshot}
                                alt="The Media Library showing four cat statue models"
                                loading="lazy"
                            />
                            <div className="landing-glass landing-build-card" aria-hidden="true">
                                <div className="landing-build-card-head">
                                    <strong>Cat statue</strong>
                                    <small>Started a min ago</small>
                                </div>
                                <ul>
                                    {BUILD_STEPS.map((step) => (
                                        <li key={step.label} className={step.state}>
                                            <span className="landing-build-dot" />
                                            <span>{step.label}</span>
                                            <span className="landing-build-value">{step.value}</span>
                                            {step.progress !== undefined && (
                                                <span className="landing-bar">
                                                    <span style={{ width: `${step.progress * 100}%` }} />
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="landing-panel is-dark is-grid" id="how-it-works">
                    <div className="landing-container landing-split">
                        <div className="landing-split-copy">
                            <h2>Three steps from photos to a model.</h2>
                            <p className="landing-lead">
                                You take the photos. Genesis builds the model in the cloud while you carry on
                                in your browser.
                            </p>
                            <ol className="landing-steps">
                                {STEPS.map((step, index) => (
                                    <li key={step.title}>
                                        <span className="landing-step-number">{String(index + 1).padStart(2, '0')}</span>
                                        <span>
                                            <h3>{step.title}</h3>
                                            <p>{step.text}</p>
                                        </span>
                                    </li>
                                ))}
                            </ol>
                            <p className="landing-video-note">
                                <Icon name="video" size={18} />
                                Shot a video instead? The Video Frame Extractor pulls the frames out for you.
                            </p>
                        </div>

                        <div className="landing-tilted" aria-hidden="true">
                            <div className="landing-tilted-window">
                                <div className="landing-tilted-bar">
                                    <span /><span /><span />
                                </div>
                                <img src={homeScreenshot} alt="" loading="lazy" />
                            </div>
                            <div className="landing-glass landing-toast">
                                <img src={catFrontImage} alt="" />
                                <span>
                                    <strong>Cat statue is ready</strong>
                                    <small>Open it, or add it to a scene</small>
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="landing-panel is-light" id="plans">
                    <div className="landing-container">
                        <div className="landing-plans-head">
                            <h2>Plans</h2>
                            <p>Prices are still being set. Free stays free.</p>
                        </div>
                        <div className="landing-billing" role="group" aria-label="Billing">
                            {['monthly', 'annual'].map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    aria-pressed={billing === option}
                                    onClick={() => {
                                        setBilling(option);
                                    }}
                                >
                                    {option === 'monthly' ? 'Monthly' : 'Annual'}
                                </button>
                            ))}
                        </div>
                        <div className="landing-plans">
                            {PLANS.map((plan) => (
                                <article key={plan.id} className="landing-plan">
                                    <div className="landing-plan-image">
                                        <img src={PLAN_IMAGES[plan.id]} alt="" loading="lazy" />
                                        <h3>{plan.name.replace('Genesis ', '')}</h3>
                                    </div>
                                    <div className="landing-plan-body">
                                        <p className="landing-plan-price">
                                            <strong>${'\u2013'}</strong> / {billing === 'monthly' ? 'month' : 'year'}
                                        </p>
                                        <p className="landing-plan-billed">
                                            {billing === 'monthly' ? 'Billed monthly' : 'Billed yearly'}
                                        </p>
                                        <p className="landing-plan-audience">{plan.description}</p>
                                        <ul>
                                            {plan.features.map((feature) => (
                                                <li key={feature}>
                                                    <Icon name="check" size={14} />
                                                    {feature}
                                                </li>
                                            ))}
                                        </ul>
                                        <PillButton tone={plan.isFeatured ? 'pink' : 'dark'} isWide onClick={getStarted}>
                                            {plan.id === 'free' ? 'Start free' : `Choose ${plan.name.replace('Genesis ', '')}`}
                                        </PillButton>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="landing-panel is-dark is-grain landing-cta">
                    <div className="landing-container landing-cta-inner">
                        <div>
                            <h2>Pick an object<br />on your desk.</h2>
                            <PillButton onClick={getStarted}>Get started free</PillButton>
                        </div>
                        <img className="landing-cta-render" src={catSideImage} alt="" aria-hidden="true" loading="lazy" />
                    </div>
                </section>
            </main>

            <footer className="landing-container landing-footer">
                {logo}
                <p>{'\u00a9'} 2026 CoDe-Fine, a GAM300 student project</p>
            </footer>
        </div>
    );
}

export default LandingScreen;