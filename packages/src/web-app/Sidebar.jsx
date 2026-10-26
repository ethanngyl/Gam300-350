/*!************************************************************************
\file Sidebar.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-10-2026
\brief
Left sidebar shown on every dashboard page: a "New model" button that
opens the camera capture page, workspace shortcuts (Media Library, Photo
Editor, Scene Builder, YouTube Extractor, Model Viewer). Recent work is
on the Home page, so there are no separate shortcuts for it here. The
item for the current page is highlighted. On phones it becomes a slide-in
drawer: isOpen shows it, and every item calls onClose so the drawer shuts
after a choice is made.
**************************************************************************/

import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

const WORKSPACE_ITEMS = [
    { id: 'library', label: 'Media Library', icon: 'layers' },
    { id: 'editor', label: 'Photo Editor', icon: 'edit' },
    { id: 'scene', label: 'Scene Builder', icon: 'shield' },
    { id: 'youtube', label: 'YouTube Extractor', icon: 'play' },
    { id: 'viewer', label: 'Model Viewer', icon: 'cube' },
];

function Sidebar({ activeTab, onNavigate, onNewModel, isOpen, onClose }) {
    const isCapturePage = activeTab === 'capture';

    return (
        <aside className={isOpen ? 'genesis-sidebar is-open' : 'genesis-sidebar'}>
            <button
                className={
                    isCapturePage
                        ? 'forma-btn forma-btn-primary genesis-new-model is-active'
                        : 'forma-btn forma-btn-primary genesis-new-model'
                }
                onClick={() => {
                    playSound('tap');
                    onClose();
                    onNewModel();
                }}
            >
                <Icon name="plus" size={14} /> New model
            </button>

            <div className="genesis-side-label">Workspace</div>
            {WORKSPACE_ITEMS.map((item) => (
                <button
                    key={item.id}
                    className={activeTab === item.id ? 'genesis-side-item is-active' : 'genesis-side-item'}
                    onClick={() => {
                        playSound('tap');
                        onClose();
                        onNavigate(item.id);
                    }}
                >
                    <Icon name={item.icon} size={15} /> {item.label}
                </button>
            ))}
        </aside>
    );
}

export default Sidebar;