import { useState } from 'react';

const MODELS = [
    { name: 'Ceramic Vase A', poly: '14.2k poly', date: 'Sep 15', status: 'ready' },
    { name: 'Stone Fragment', poly: '8.7k poly', date: 'Sep 15', status: 'ready' },
    { name: 'Wooden Chair', poly: '22.1k poly', date: 'Sep 14', status: 'ready' },
    { name: 'Metal Bracket', poly: '5.3k poly', date: 'Sep 13', status: 'ready' },
    { name: 'Glass Bottle', poly: '11.6k poly', date: 'Sep 12', status: 'processing' },
    { name: 'Terracotta Pot', poly: '9.4k poly', date: 'Sep 10', status: 'ready' },
];

// Each photo batch is a group -- either an upload session or an
// extracted set of YouTube frames. Real data will eventually come
// from Gabriel's per-scan storage (scans/<id>/photos/), grouped the
// same way here.
const PHOTO_BATCHES = [
    {
        id: 'batch-sep15',
        label: 'Batch Upload — Sep 15, 2:34 PM',
        images: ['IMG_001', 'IMG_002', 'IMG_003', 'IMG_004', 'IMG_005', 'IMG_006'],
    },
    {
        id: 'batch-sep14',
        label: 'Batch Upload — Sep 14, 10:11 AM',
        images: ['IMG_001', 'IMG_002', 'IMG_003', 'IMG_004'],
    },
    {
        id: 'youtube-sep12',
        label: 'YouTube Extract — Sep 12 (vase-video)',
        images: ['IMG_001', 'IMG_002', 'IMG_003', 'IMG_004', 'IMG_005', 'IMG_006', 'IMG_007', 'IMG_008', 'IMG_009'],
    },
];

function LibraryScreen({ onGenerateModel, onUploadPhotos }) {
    const [subTab, setSubTab] = useState('models');
    const [search, setSearch] = useState('');

    const filteredModels = MODELS.filter((m) =>
        m.name.toLowerCase().includes(search.toLowerCase())
    );

    const filteredBatches = PHOTO_BATCHES.filter((batch) =>
        batch.label.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="library-screen">
            <div className="library-toolbar">
                <div className="library-subtabs">
                    <button
                        className={subTab === 'models' ? 'library-subtab is-active' : 'library-subtab'}
                        onClick={() => setSubTab('models')}
                    >
                        3D Models
                    </button>
                    <button
                        className={subTab === 'photos' ? 'library-subtab is-active' : 'library-subtab'}
                        onClick={() => setSubTab('photos')}
                    >
                        Photo Library
                    </button>
                </div>

                <input
                    className="library-search"
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />

                <button className="forma-btn">Filter</button>

                {/* Button label/action swaps with the active sub-tab,
                    same as the Figma reference -- both still route into
                    your existing camera/upload flow. */}
                {subTab === 'models' ? (
                    <button className="forma-btn forma-btn-primary" onClick={onGenerateModel}>
                        + Generate Model
                    </button>
                ) : (
                    <button className="forma-btn forma-btn-primary" onClick={onUploadPhotos}>
                        + Upload Photos
                    </button>
                )}
            </div>

            {subTab === 'models' ? (
                <div className="library-grid">
                    {filteredModels.map((model) => (
                        <div key={model.name} className="forma-card library-item">
                            <div className="forma-thumb library-thumb">
                                <span
                                    className={
                                        model.status === 'ready'
                                            ? 'forma-badge forma-badge-ready'
                                            : 'forma-badge forma-badge-processing'
                                    }
                                >
                                    {model.status === 'ready' ? 'Ready' : 'Processing'}
                                </span>
                                ◆
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
                <div className="photo-library">
                    {filteredBatches.map((batch) => (
                        <div key={batch.id} className="photo-batch">
                            <div className="photo-batch-header">
                                <span className="photo-batch-icon">▢</span>
                                <span className="photo-batch-label">{batch.label}</span>
                                <span className="forma-badge photo-batch-count">
                                    {batch.images.length} images
                                </span>
                                <span className="photo-batch-divider"></span>
                                <button className="photo-batch-link">Open in Editor →</button>
                            </div>

                            <div className="photo-batch-grid">
                                {batch.images.map((imgName) => (
                                    <div key={imgName} className="photo-batch-thumb">
                                        <span className="photo-batch-thumb-icon">▤</span>
                                        <span className="photo-batch-thumb-name">{imgName}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default LibraryScreen;