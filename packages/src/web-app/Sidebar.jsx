/*!************************************************************************
\file Sidebar.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 09-10-2026
\brief
Left sidebar shown on every dashboard screen: a "New model" button that
starts the capture flow, workspace shortcuts (Media Library, Photo Editor,
Scene Builder, YouTube Extractor), "Your work" shortcuts that open the
Library on its 3D Models or Photo Library sub-tab, and a status footer.
On phones it becomes a slide-in drawer: isOpen shows it, and every item
calls onClose so the drawer shuts after a choice is made.
**************************************************************************/

import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

const WORKSPACE_ITEMS = [
    { id: 'library', label: 'Media Library', icon: 'layers' },
    { id: 'editor', label: 'Photo Editor', icon: 'edit' },
    { id: 'scene', label: 'Scene Builder', icon: 'shield' },
    { id: 'youtube', label: 'YouTube Extractor', icon: 'play' },
];

const WORK_ITEMS = [
    { id: 'recent', label: 'Recent projects', icon: 'folder', librarySubTab: 'models' },
    { id: 'source', label: 'Source photos', icon: 'image', librarySubTab: 'photos' },
];

function Sidebar({ activeTab, onNavigate, onOpenLibrary, onNewModel, onYoutube, isOpen, onClose }) {
    function handleWorkspaceClick(itemId) {
        playSound('click');
        onClose();
        if (itemId === 'youtube') {
            onYoutube();
        } else {
            onNavigate(itemId);
        }
    }

    return (
        <aside className={isOpen ? 'genesis-sidebar is-open' : 'genesis-sidebar'}>
            <button
                className="forma-btn forma-btn-primary genesis-new-model"
                onClick={() => {
                    playSound('click');
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
                    onClick={() => handleWorkspaceClick(item.id)}
                >
                    <Icon name={item.icon} size={15} /> {item.label}
                </button>
            ))}

            <div className="genesis-side-label">Your work</div>
            {WORK_ITEMS.map((item) => (
                <button
                    key={item.id}
                    className="genesis-side-item"
                    onClick={() => {
                        playSound('click');
                        onClose();
                        onOpenLibrary(item.librarySubTab);
                    }}
                >
                    <Icon name={item.icon} size={15} /> {item.label}
                </button>
            ))}

            <div className="genesis-side-status">
                <span className="forma-status-dot"></span>
                All systems ready
            </div>
        </aside>
    );
}

export default Sidebar;