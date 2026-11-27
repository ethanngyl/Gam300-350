/*!************************************************************************
\file StartScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 26-11-2026
\brief
"How do you want to start?", shown once, the first time an account signs
in on this browser (phones and wider screens), as in the Figma's mobile
start screen. Three ways to make a first model, each something Genesis
does today:
- Upload photos: opens the New model dialog.
- Use a video: opens the Video Extractor.
- Take pictures: opens the camera (Capture).
"Skip for now" goes straight to Home. Either way App then shows the
welcome card, which offers the tour.
- StartScreen({ onUploadPhotos, onUseVideo, onUseCamera, onSkip })
React component.
**************************************************************************/

import Icon from './Icons.jsx';
import genesisLogo from '../assets/GenesisLogo.svg';
import './StartScreen.css';

const START_OPTIONS = [
    {
        id: 'photos',
        icon: 'upload',
        title: 'Upload photos',
        text: 'Choose at least 8 photos of one object, taken as you walk around it. 40 to 80 works best.',
    },
    {
        id: 'video',
        icon: 'video',
        title: 'Use a video',
        text: 'Upload a slow walkaround video, and Genesis pulls the sharp frames out for you.',
    },
    {
        id: 'camera',
        icon: 'camera',
        title: 'Take pictures',
        text: 'Use this device\u2019s camera. Genesis counts your shots as you move around the object.',
    },
];

function StartScreen({ onUploadPhotos, onUseVideo, onUseCamera, onSkip }) {
    const actions = { photos: onUploadPhotos, video: onUseVideo, camera: onUseCamera };

    return (
        <div className="start-screen" role="dialog" aria-modal="true" aria-labelledby="start-screen-title">
            <div className="start-screen-inner">
                <span className="start-screen-logo">
                    <img src={genesisLogo} alt="" />
                    GENESIS
                </span>

                <h1 id="start-screen-title">How do you want to start?</h1>
                <p className="start-screen-lead">Pick one to make your first model. You can always try the others later.</p>

                <ul className="start-screen-options">
                    {START_OPTIONS.map((option) => (
                        <li key={option.id}>
                            <button type="button" className="start-screen-option" onClick={actions[option.id]}>
                                <span className="start-screen-option-icon" aria-hidden="true">
                                    <Icon name={option.icon} size={20} />
                                </span>
                                <span className="start-screen-option-copy">
                                    <strong>{option.title}</strong>
                                    <small>{option.text}</small>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>

                <button type="button" className="start-screen-skip" onClick={onSkip}>
                    Skip for now
                </button>
            </div>
        </div>
    );
}

export default StartScreen;