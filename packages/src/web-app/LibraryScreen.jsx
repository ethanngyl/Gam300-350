/*!************************************************************************
\file LibraryScreen.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Library tab with two sub-views: a searchable, sortable grid of generated
3D models (still static mock data) and a Photo Library that embeds
ImageGallery in its compact variant to show real uploaded / extracted
photo batches from the backend. The active sub-tab is controlled by the
parent so the sidebar can open either one directly.
**************************************************************************/

import Icon from './Icons.jsx';
import ImageGallery from './ImageGallery.jsx';
import { useState } from 'react';

const MODELS = [
    { name: 'Ceramic Vase A', poly: '14.2k poly', date: 'Sep 15', status: 'ready' },
    { name: 'Stone Fragment', poly: '8.7k poly', date: 'Sep 15', status: 'ready' },
    { name: 'Wooden Chair', poly: '22.1k poly', date: 'Sep 14', status: 'ready' },
    { name: 'Metal Bracket', poly: '5.3k poly', date: 'Sep 13', status: 'ready' },
    { name: 'Glass Bottle', poly: '11.6k poly', date: 'Sep 12', status: 'processing' },
    { name: 'Terracotta Pot', poly: '9.4k poly', date: 'Sep 10', status: 'ready' },
];

function LibraryScreen({ subTab, onSubTabChange, onGenerateModel, onUploadPhotos }) {
    const [search, setSearch] = useState('');
    const [sortOrder, setSortOrder] = useState('newest');

    const visibleModels = MODELS.filter((model) =>
        model.name.toLowerCase().includes(search.toLowerCase())
    );
    if (sortOrder === 'oldest') visibleModels.reverse();
    if (sortOrder === 'name') visibleModels.sort((a, b) => a.name.localeCompare(b.name));

    return (
        <div className="library-screen">
            <div className="library-toolbar">
                <div className="library-subtabs">
                    <button
                        className={subTab === 'models' ? 'library-subtab is-active' : 'library-subtab'}
                        onClick={() => onSubTabChange('models')}
                    >
                        3D Models
                    </button>
                    <button
                        className={subTab === 'photos' ? 'library-subtab is-active' : 'library-subtab'}
                        onClick={() => onSubTabChange('photos')}
                    >
                        Photo Library
                    </button>
                </div>

                <label className="library-search">
                    <Icon name="search" size={14} />
                    <input
                        placeholder="Search..."
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                </label>

                <label className="library-sort">
                    <Icon name="filter" size={13} />
                    <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                        <option value="name">Name</option>
                    </select>
                    <Icon name="chevron" size={13} />
                </label>

                {subTab === 'models' ? (
                    <button className="forma-btn forma-btn-primary" onClick={onGenerateModel}>
                        <Icon name="plus" size={14} /> Generate Model
                    </button>
                ) : (
                    <button className="forma-btn forma-btn-primary" onClick={onUploadPhotos}>
                        <Icon name="plus" size={14} /> Upload Photos
                    </button>
                )}
            </div>

            {subTab === 'models' ? (
                <div className="library-grid">
                    {visibleModels.map((model) => (
                        <div key={model.name} className="forma-card library-item">
                            <div className="library-thumb">
                                <span
                                    className={
                                        model.status === 'ready'
                                            ? 'forma-badge forma-badge-ready'
                                            : 'forma-badge forma-badge-processing'
                                    }
                                >
                                    {model.status === 'ready' ? 'Ready' : 'Processing'}
                                </span>
                                <Icon name="layers" size={44} />
                            </div>
                            <div className="library-item-name">{model.name}</div>
                            <div className="library-item-meta">
                                <span>{model.poly}</span>
                                <span>{model.date}</span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                // Live data: fetched and owned by ImageGallery's own load() logic.
                <ImageGallery variant="compact" searchTerm={search} sortOrder={sortOrder} />
            )}
        </div>
    );
}

export default LibraryScreen;