/*!************************************************************************
\file LandingScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
The landing page signed-out visitors see first, laid out like the Genesis
landing page design. Top to bottom: a top bar (logo, links to Product,
Gallery and Plans, Log in, Get started); the headline, with photos on the
left turning into a model on the right; the three steps; Inside Genesis
(the Photo Editor, Media Library and Scene Builder, with a line about the
Video Extractor); Made with Genesis; Plans (the plans in plans.js); a
closing call to action; and the footer. "Log in" opens the login screen;
"Get started" opens it in create-account mode.
The pictures are our own (landing/): screenshots of the real app, renders
of the cat statue sample model, and photos from the sample photo set.
- LandingScreen({ onLogIn, onGetStarted })
React component.
**************************************************************************/

import Icon from './Icons.jsx';
import genesisLogo from './GenesisLogo.svg';
import { PLANS } from './plans.js';
import { playSound } from '../audio/Audio.js';
import photoEditorScreenshot from './landing/app-photo-editor.webp';
import mediaLibraryScreenshot from './landing/app-media-library.webp';
import sceneBuilderScreenshot from './landing/app-scene-builder.webp';
import catFrontImage from './landing/cat-front.webp';
import catSideImage from './landing/cat-side.webp';
import catTurnedImage from './landing/cat-turned.webp';
import sceneCatImage from './landing/scene-cat.webp';
import photo1Image from './landing/photo-1.webp';
import photo2Image from './landing/photo-2.webp';
import photo3Image from './landing/photo-3.webp';
import photo4Image from './landing/photo-4.webp';
import photo5Image from './landing/photo-5.webp';
import './LandingScreen.css';

const NAV_LINKS = [
    { id: 'product', label: 'Product' },
    { id: 'gallery', label: 'Gallery' },
    { id: 'plans', label: 'Plans' },
];

// The photos fanned out on the left of the headline, back to front.
const HERO_PHOTOS = [photo1Image, photo4Image, photo3Image, photo5Image, photo2Image];

// Dots between the photos and the model, growing towards the model.
const HERO_DOT_COUNT = 12;

const STEPS = [
    {
        title: 'You shoot the object',
        text: '40 to 80 overlapping photos, or frames pulled from a video.',
    },
    {
        title: 'Genesis does the maths',
        text: 'Every shot is aligned in 3D, then rebuilt as a splat model in the cloud.',
    },
    {
        title: 'You get a real model',
        text: 'Orbit it, clean it up, drop it into a scene and download it.',
    },
];

const FEATURES = [
    {
        title: 'Photo editor',
        text: 'Catch the bad shots before you build. Blurry and duplicate photos are flagged for you. Leave them out in one click, fix exposure on the rest, then generate.',
        image: photoEditorScreenshot,
        imageAlt: 'The Photo Editor with twelve photos of the fox sample, ready to build',
    },
    {
        title: 'Media library',
        text: 'Every model and every photo batch, together. Source photos stay linked to the model they built, so you can go back and rebuild with a better set.',
        image: mediaLibraryScreenshot,
        imageAlt: 'The Media Library showing four cat statue models',
    },
    {
        title: 'Scene builder',
        text: 'Put your models somewhere. Arrange scans in one space, move, rotate and scale them, then save the scene or take a screenshot.',
        image: sceneBuilderScreenshot,
        imageAlt: 'The Scene Builder with the cat statue model selected',
    },
];

// isTall cards are taller, so the row steps up and down like the design.
const GALLERY = [
    { name: 'Cat statue', kind: '3D model', image: catFrontImage, isTall: true },
    { name: 'Fox', kind: 'Source photos', image: photo2Image },
    { name: 'Cat statue scene', kind: 'Genesis project', image: sceneCatImage, isTall: true },
    { name: 'Cat statue', kind: 'Side view', image: catSideImage },
];

function scrollToSection(sectionId) {
    playSound('tap');
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function LandingScreen({ onLogIn, onGetStarted }) {
    function logIn() {
        playSound('tap');
        onLogIn();
    }

    function getStarted() {
        playSound('confirm');
        onGetStarted();
    }

    const logo = (
        <span className="landing-logo">
            <img src={genesisLogo} alt="" />
            GENESIS
        </span>
    );

    const getStartedFreeButton = (
        <button type="button" className="forma-btn forma-btn-primary landing-big-button" onClick={getStarted}>
            <Icon name="upload" size={16} /> Get started free
        </button>
    );

    return (
        <div className="landing-page">
            <header className="landing-nav">
                <div className="landing-container landing-nav-inner">
                    {logo}
                    <nav className="landing-nav-links" aria-label="Sections">
                        {NAV_LINKS.map((link) => (
                            <button key={link.id} type="button" onClick={() => scrollToSection(link.id)}>
                                {link.label}
                            </button>
                        ))}
                    </nav>
                    <div className="landing-nav-actions">
                        <button type="button" className="landing-text-button" onClick={logIn}>Log in</button>
                        <button type="button" className="forma-btn forma-btn-primary" onClick={getStarted}>Get started</button>
                    </div>
                </div>
            </header>

            <main>
                <section className="landing-container landing-hero">
                    <div className="landing-headline-row">
                        <h1>Build 3D models<br />from photos.</h1>
                        <div className="landing-actions">
                            {getStartedFreeButton}
                            <button type="button" className="forma-btn landing-big-button" onClick={logIn}>Log in</button>
                        </div>
                    </div>

                    <div className="landing-hero-visual" aria-hidden="true">
                        <div className="landing-photo-stack">
                            {HERO_PHOTOS.map((photo, index) => (
                                <img key={index} className={`landing-stack-photo is-photo-${index + 1}`} src={photo} alt="" />
                            ))}
                        </div>
                        <div className="landing-hero-dots">
                            {Array.from({ length: HERO_DOT_COUNT }, (_, index) => (
                                <span key={index} style={{ '--dot-step': index / (HERO_DOT_COUNT - 1) }} />
                            ))}
                        </div>
                        <figure className="landing-model-card">
                            <img src={catTurnedImage} alt="" />
                            <figcaption>
                                <strong>Cat statue</strong> Sample model
                            </figcaption>
                        </figure>
                    </div>

                    <div className="landing-steps">
                        {STEPS.map((step) => (
                            <div key={step.title} className="landing-step">
                                <h3>{step.title}</h3>
                                <p>{step.text}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="landing-container landing-section" id="product">
                    <div className="landing-section-head">
                        <h2>Inside Genesis</h2>
                        <p>The same workspace you log in to. Every picture here is a screenshot of the real app.</p>
                    </div>

                    <div className="landing-features">
                        {FEATURES.map((feature, index) => (
                            <article key={feature.title} className={index % 2 === 1 ? 'landing-feature is-flipped' : 'landing-feature'}>
                                <div className="landing-feature-copy">
                                    <h3>{feature.title}</h3>
                                    <p>{feature.text}</p>
                                </div>
                                <img className="landing-feature-shot" src={feature.image} alt={feature.imageAlt} loading="lazy" />
                            </article>
                        ))}
                    </div>

                    <p className="landing-extractor-note">
                        <Icon name="film" size={18} />
                        Shot a video instead? The Video Extractor pulls sharp, overlapping frames out of it for you.
                    </p>
                </section>

                <section className="landing-container landing-section" id="gallery">
                    <div className="landing-section-head">
                        <h2>Made with Genesis</h2>
                    </div>
                    <div className="landing-gallery">
                        {GALLERY.map((item) => (
                            <figure key={item.kind} className={item.isTall ? 'landing-gallery-item is-tall' : 'landing-gallery-item'}>
                                <img src={item.image} alt={`${item.name}: ${item.kind.toLowerCase()}`} loading="lazy" />
                                <figcaption>
                                    <strong>{item.name}</strong> {item.kind}
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                </section>

                <section className="landing-container landing-section" id="plans">
                    <div className="landing-section-head">
                        <h2>Plans</h2>
                        <p>Prices are still being set. Free stays free.</p>
                    </div>
                    <div className="landing-plans">
                        {PLANS.map((plan) => (
                            <div key={plan.id} className="landing-plan">
                                <h3>
                                    {plan.name.replace('Genesis ', '')}
                                    <small>${'\u2014'} / month</small>
                                </h3>
                                <p className="landing-plan-audience">{plan.description}</p>
                                <ul>
                                    {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                                </ul>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="landing-container landing-cta">
                    <h2>Pick an object<br />on your desk.</h2>
                    {getStartedFreeButton}
                </section>
            </main>

            <footer className="landing-footer">
                <div className="landing-container landing-footer-inner">
                    {logo}
                    <p>{'\u00a9'} 2026 CoDe-Fine {'\u00b7'} a GAM300 student project</p>
                </div>
            </footer>
        </div>
    );
}

export default LandingScreen;