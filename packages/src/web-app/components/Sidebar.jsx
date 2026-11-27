/*!************************************************************************
\file Sidebar.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 27-10-2026
\brief
Left sidebar of the app on wider screens (above 760px; phones have a
camera button instead, App.jsx), laid out like the Genesis Figma: a "New" button at the
top, the workspace pages as an icon with a short label under it, and
"Learn" at the bottom, which replays the walkthrough.
"New" opens the New model dialog (AddPhotosDialog.jsx): upload photos,
choose them from the Media Library, or capture with the camera.
Feedback moved to the account menu ("Send feedback"), as in the Figma.
- SIDEBAR_PAGES
The workspace pages, top to bottom.
- Sidebar({ activeTab, onNavigate, onNewModel, onLearn })
React component. activeTab is highlighted.
**************************************************************************/

import Icon from './Icons.jsx';

const SIDEBAR_PAGES = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'library', label: 'Media Library', icon: 'image' },
    { id: 'editor', label: 'Photo Editor', icon: 'sliders' },
    { id: 'scene', label: 'Scene Builder', icon: 'cube' },
    { id: 'extractor', label: 'Video Extractor', icon: 'film' },
    { id: 'viewer', label: 'Model Viewer', icon: 'layers' },
];

function Sidebar({ activeTab, onNavigate, onNewModel, onLearn }) {
    return (
        <nav className="app-sidebar" aria-label="Workspace">
            <div className="app-sidebar-new">
                <button
                    type="button"
                    className="app-sidebar-new-button"
                    aria-label="New"
                    aria-haspopup="dialog"
                    onClick={() => {
                        onNewModel();
                    }}
                >
                    <span className="app-sidebar-new-icon"><Icon name="plus" size={20} /></span>
                    <span className="app-sidebar-label">New</span>
                </button>
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