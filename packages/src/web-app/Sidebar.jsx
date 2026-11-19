/*!************************************************************************
\file Sidebar.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 27-10-2026
\brief
Left sidebar of the app on wider screens (above 760px; phones keep the
dock, Dock.jsx), laid out like the Genesis Figma: a "New" button at the
top, the workspace pages as an icon with a short label under it, and
"Learn" at the bottom, which replays the walkthrough.
"New" opens a small menu: "Capture with camera" opens the capture page,
and "Upload photos" opens the file picker and hands the chosen photos to
the capture page (the same two actions the dock had).
- SIDEBAR_PAGES
The workspace pages, top to bottom.
- Sidebar({ activeTab, onNavigate, onNewModel, onAddPhotos, onLearn })
React component. activeTab is highlighted.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

const SIDEBAR_PAGES = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'library', label: 'Media Library', icon: 'image' },
    { id: 'editor', label: 'Photo Editor', icon: 'sliders' },
    { id: 'scene', label: 'Scene Builder', icon: 'cube' },
    { id: 'extractor', label: 'Video Extractor', icon: 'film' },
    { id: 'viewer', label: 'Model Viewer', icon: 'layers' },
    { id: 'feedback', label: 'Feedback', icon: 'message' },
];

function Sidebar({ activeTab, onNavigate, onNewModel, onAddPhotos, onLearn }) {
    const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);
    const newMenuRef = useRef(null);
    const fileInputRef = useRef(null);

    // The New menu closes on a click outside it or on Escape.
    useEffect(() => {
        if (!isNewMenuOpen) return undefined;
        function closeOnOutsideClick(event) {
            if (!newMenuRef.current?.contains(event.target)) setIsNewMenuOpen(false);
        }
        function closeOnEscape(event) {
            if (event.key === 'Escape') setIsNewMenuOpen(false);
        }
        document.addEventListener('pointerdown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isNewMenuOpen]);

    function handleFilesChosen(event) {
        const chosenFiles = Array.from(event.target.files ?? []);
        // Clear so choosing the same files again still fires onChange.
        event.target.value = '';
        if (chosenFiles.length > 0) onAddPhotos(chosenFiles);
    }

    return (
        <nav className="app-sidebar" aria-label="Workspace">
            <div className="app-sidebar-new" ref={newMenuRef}>
                <button
                    type="button"
                    className="app-sidebar-new-button"
                    aria-label="New"
                    aria-haspopup="menu"
                    aria-expanded={isNewMenuOpen}
                    onClick={() => {
                        playSound('tap');
                        setIsNewMenuOpen((isOpen) => !isOpen);
                    }}
                >
                    <span className="app-sidebar-new-icon"><Icon name="plus" size={20} /></span>
                    <span className="app-sidebar-label">New</span>
                </button>
                {isNewMenuOpen && (
                    <div className="app-menu app-sidebar-new-menu" role="menu">
                        <button
                            type="button"
                            role="menuitem"
                            className="app-menu-item"
                            onClick={() => {
                                playSound('confirm');
                                setIsNewMenuOpen(false);
                                onNewModel();
                            }}
                        >
                            <Icon name="camera" size={16} />
                            <span>
                                <strong>Capture with camera</strong>
                                <small>Take photos from every angle</small>
                            </span>
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            className="app-menu-item"
                            onClick={() => {
                                playSound('tap');
                                setIsNewMenuOpen(false);
                                fileInputRef.current?.click();
                            }}
                        >
                            <Icon name="upload" size={16} />
                            <span>
                                <strong>Upload photos</strong>
                                <small>40{'\u2013'}80 overlapping shots</small>
                            </span>
                        </button>
                    </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFilesChosen} />
            </div>

            <div className="app-sidebar-pages">
                {SIDEBAR_PAGES.map((page) => (
                    <button
                        key={page.id}
                        type="button"
                        className={activeTab === page.id ? 'app-sidebar-item is-active' : 'app-sidebar-item'}
                        aria-label={page.label}
                        aria-current={activeTab === page.id ? 'page' : undefined}
                        onClick={() => {
                            playSound('tap');
                            onNavigate(page.id);
                        }}
                    >
                        <Icon name={page.icon} size={20} />
                        <span className="app-sidebar-label">{page.label}</span>
                    </button>
                ))}
            </div>

            <button
                type="button"
                className="app-sidebar-item app-sidebar-learn"
                aria-label="Learn"
                onClick={() => {
                    playSound('tap');
                    onLearn();
                }}
            >
                <Icon name="book" size={20} />
                <span className="app-sidebar-label">Learn</span>
            </button>
        </nav>
    );
}

export default Sidebar;