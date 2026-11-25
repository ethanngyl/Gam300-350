/*!************************************************************************
\file TipsContent.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 25-11-2026
\brief
The words of the first-run tips (Tips.jsx) and which part of the page
each one sits beside. Kept apart from Tips.jsx so that file only exports
components.
- TOUR_TIPS
The tour, in order: the Photo Editor, then the Scene Builder.
- VIDEO_TIP
Shown the first time the Video Extractor opens.
**************************************************************************/

// The tour, in order. target: CSS selector of what the tip sits beside;
// placement: which side of it.
export const TOUR_TIPS = [
    {
        id: 'editor',
        page: 'editor',
        title: 'Flagged photos stay out of the build',
        text: 'Blurry and duplicate shots get a red label. Click one to see why, or keep it anyway.',
        target: '.photo-editor-heading',
        placement: 'below',
    },
    {
        id: 'scene',
        page: 'scene',
        title: 'Your models are in the Library tab',
        text: 'Drag one into the viewport to place it. The Scene tab lists everything already in the scene.',
        target: '.scene-builder-outliner',
        placement: 'right',
    },
];

export const VIDEO_TIP = {
    id: 'extractor',
    title: 'Got a video instead of photos?',
    text: 'Upload a slow walkaround video. Genesis keeps the sharpest frames and drops the blurry ones.',
    target: '.fx-layout',
    placement: 'inside',
};