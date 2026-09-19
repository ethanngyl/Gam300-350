import { useEffect, useState } from 'react';
import './ImageGallery.css';

// Shows every photo stored under backend/jobs/<jobId>/images, grouped by job.
// Data comes from GET /jobs (list) and GET /jobs/:id/images/:name (each image).
function ImageGallery({ onBack }) {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                const res = await fetch('/jobs');
                if (!res.ok) throw new Error(`Server returned ${res.status}`);
                const data = await res.json();
                if (!cancelled) setJobs(data);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        // Ignore the response if the user navigates away before it arrives.
        return () => { cancelled = true; };
    }, []);

    return (
        <div className="gallery">
            <div className="gallery-head">
                <button className="btn btn-ghost" onClick={onBack}>← Back</button>
                <h2>Uploaded images</h2>
            </div>

            {loading && <p className="gallery-note">Loading…</p>}
            {error && <p className="gallery-note gallery-error">Couldn't load images: {error}</p>}
            {!loading && !error && jobs.length === 0 && (
                <p className="gallery-note">No images uploaded yet.</p>
            )}

            {jobs.map((job) => (
                <section key={job.id} className="gallery-job">
                    <h3>
                        Job {job.id.slice(0, 8)}
                        <span>{job.images.length} photos</span>
                    </h3>
                    <div className="gallery-grid">
                        {job.images.map((img) => (
                            <a key={img.name} href={img.url} target="_blank" rel="noreferrer">
                                <img
                                    src={img.url}
                                    alt={`Job ${job.id.slice(0, 8)} - ${img.name}`}
                                    loading="lazy"
                                />
                            </a>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

export default ImageGallery;
