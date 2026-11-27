/*!************************************************************************
\file TipsContent.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 25-11-2026
\brief
The words of the first-run tip (Tips.jsx) and which part of the page it
sits beside. The tour itself is the walkthrough (Walkthrough.jsx). Kept
apart from Tips.jsx so that file only exports components.
- VIDEO_TIP
Shown the first time the Video Extractor opens.
**************************************************************************/

export const VIDEO_TIP = {
    id: 'extractor',
    title: 'Got a video instead of photos?',
    text: 'Upload a slow walkaround video. Genesis keeps the sharpest frames and drops the blurry ones.',
    target: '.fx-layout',
    placement: 'inside',
};