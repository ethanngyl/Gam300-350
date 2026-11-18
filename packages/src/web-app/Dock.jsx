/*!************************************************************************
\file Dock.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 31-10-2026
\brief
The phone tab bar: a full-width bar along the bottom of every dashboard
page in the mobile view (760px wide or less; wider screens use the sidebar,
Sidebar.jsx). Laid out like the Genesis mobile Figma: four tabs at a time,
each an icon with a short label, with Capture raised in the middle. An
arrow button on the right slides to the next four (on the last four it
points back and returns to the first); the tabs can also be swiped. The
four that hold the current page are shown when the page changes.
The tabs: Home, Library, Capture (opens the camera capture page) and
Editor, then Scene Builder, Video Extractor, Model Viewer and Feedback.
The account menu, search and notifications are in the top bar on phones
too (TopNav.jsx).
- Dock({ activeTab, onNavigate, onNewModel })
React component. activeTab is highlighted.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

// Four to a page, in this order. aria-labels (label) match the sidebar's,
// so the walkthrough finds the same items.
const DOCK_TABS = [
    { id: 'home', label: 'Home', shortLabel: 'Home', icon: 'home' },
    { id: 'library', label: 'Media Library', shortLabel: 'Library', icon: 'image' },
    { id: 'capture', label: 'Capture', shortLabel: 'Capture', icon: 'camera', isRaised: true },
    { id: 'editor', label: 'Photo Editor', shortLabel: 'Editor', icon: 'sliders' },
    { id: 'scene', label: 'Scene Builder', shortLabel: 'Scene', icon: 'cube' },
    { id: 'extractor', label: 'Video Extractor', shortLabel: 'Video', icon: 'film' },
    { id: 'viewer', label: 'Model Viewer', shortLabel: 'Viewer', icon: 'layers' },
    { id: 'feedback', label: 'Feedback', shortLabel: 'Feedback', icon: 'message' },
];

function Dock({ activeTab, onNavigate, onNewModel }) {
    const scrollerRef = useRef(null);
    // Whether the last tabs are showing, so the arrow points back.
    const [isAtLastTabs, setIsAtLastTabs] = useState(false);

    // Show the four tabs that hold the current page.
    useEffect(() => {
        const scroller = scrollerRef.current;
        const activeItem = scroller?.querySelector('[aria-current="page"]');
        if (!scroller || !activeItem || scroller.clientWidth === 0) return;
        const page = Math.floor(activeItem.offsetLeft / scroller.clientWidth);
        scroller.scrollTo({ left: page * scroller.clientWidth });
    }, [activeTab]);

    function selectTab(tabId) {
        playSound('tap');
        if (tabId === 'capture') onNewModel();
        else onNavigate(tabId);
    }

    // Notes whether the tabs have reached the last page.
    function handleScroll(event) {
        const scroller = event.currentTarget;
        setIsAtLastTabs(scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4);
    }

    // The arrow slides to the next four tabs, or back to the first.
    function showNextTabs() {
        playSound('tap');
        const scroller = scrollerRef.current;
        if (!scroller) return;
        if (isAtLastTabs) scroller.scrollTo({ left: 0, behavior: 'smooth' });
        else scroller.scrollBy({ left: scroller.clientWidth, behavior: 'smooth' });
    }

    return (
        <nav className="genesis-dock genesis-dock-mobile" aria-label="Workspace">
            <div className="genesis-mdock-scroller" ref={scrollerRef} onScroll={handleScroll}>
                {DOCK_TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            className={[
                                'genesis-mdock-item',
                                tab.isRaised && 'is-raised',
                                isActive && 'is-active',
                            ].filter(Boolean).join(' ')}
                            onClick={() => selectTab(tab.id)}
                            aria-label={tab.label}
                            aria-current={isActive ? 'page' : undefined}
                        >
                            <span className="genesis-mdock-icon"><Icon name={tab.icon} size={20} /></span>
                            <span className="genesis-mdock-label">{tab.shortLabel}</span>
                        </button>
                    );
                })}
            </div>
            <button
                type="button"
                className={isAtLastTabs ? 'genesis-mdock-arrow is-back' : 'genesis-mdock-arrow'}
                onClick={showNextTabs}
                aria-label={isAtLastTabs ? 'Show first tabs' : 'Show more tabs'}
            >
                <Icon name="arrow" size={16} />
            </button>
        </nav>
    );
}

export default Dock;