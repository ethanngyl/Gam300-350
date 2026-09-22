const TABS = [
    { id: 'home', label: 'Home' },
    { id: 'library', label: 'Library' },
    { id: 'editor', label: 'Photo Editor' },
    /*{ id: 'scene', label: 'Scene Builder' },*/
];

function TopNav({ activeTab, onTabChange }) {
    return (
        <nav className="forma-nav">
            <div className="forma-logo">
                <span className="forma-logo-icon">◆</span>
                FORMA 3D
            </div>

            <div className="forma-tabs">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        className={activeTab === tab.id ? 'forma-tab is-active' : 'forma-tab'}
                        onClick={() => onTabChange(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="forma-status">
                <span className="forma-status-dot"></span>
                GPU · Active
            </div>
            <div className="forma-avatar">U</div>
        </nav>
    );
}

export default TopNav;