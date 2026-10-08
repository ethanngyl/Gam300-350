/*!************************************************************************
\file ImageGallery.jsx
\author1 Bryan Lim Jun Jie
\author2 Gabriel Sebastian Putra
\par DP email1: bryanjunjie.lim@digipen.edu
\par DP email2: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
React page that shows every photo stored under backend/jobs/<jobId>/images,
grouped by job. It fetches the job list once when it opens (load() is
unchanged). The "full" variant shows a section per job with a download-on-
click thumbnail grid. The "compact" variant, used inside the Library tab's
Photo Library, shows one preview card per job (with search and sort);
clicking a card opens that job's full grid so photos can still be
downloaded.
- ImageGallery({ onBack, variant, searchTerm, sortOrder })
The gallery component.
- load()
Fetches GET /jobs and stores the result in state. Ignores the response if
the user left the page before it arrived.
- renderJobSection(job)
Renders one job's heading and download-on-click thumbnail grid.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { useEffect, useState } from 'react';
import './ImageGallery.css';

const PREVIEW_COUNT = 4;

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Shows every photo stored under backend/jobs/<jobId>/images, grouped by
    job. Data comes from GET /jobs (list) and GET /jobs/:id/images/:name
    (each image).
  \param onBack
    function, optional
    Called when the Back button is clicked. No Back button is rendered
    when omitted (the Library tab already has navigation).
  \param variant
    'full' (default) | 'compact'
  \param searchTerm
    string, compact only. Filters jobs by id or status.
  \param sortOrder
    'newest' (server order) | 'oldest' | 'name', compact only.
  \return
    The gallery page
*/
/************************************************************************/
function ImageGallery({ onBack, variant = 'full', searchTerm = '', sortOrder = 'newest' }) {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [openJobId, setOpenJobId] = useState(null);

    useEffect(() => {
        let cancelled = false;

        /************************************************************************/
        /*!
          \brief
            Fetch the job list from GET /jobs and store it in state. State is
            only updated if the component is still open.
          \return
            Sets jobs on success, or error with the message on failure.
            Always clears loading.
        */
        /************************************************************************/
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

    /************************************************************************/
    /*!
      \brief
        One job's heading plus its thumbnail grid. Clicking a thumbnail
        downloads that photo.
    */
    /************************************************************************/
    function renderJobSection(job) {
        return (
            <section key={job.id} className="gallery-job">
                <h3>
                    Job {job.id.slice(0, 8)}
                    <span>{job.status}</span>
                    <span>{job.images.length} photos</span>
                </h3>
                <div className="gallery-grid">
                    {job.images.map((img) => (
                        <a
                            key={img.name}
                            href={img.url}
                            download={`${job.id.slice(0, 8)}-${img.name}`}
                            title="Click to download"
                        >
                            <img
                                src={img.url}
                                alt={`Job ${job.id.slice(0, 8)} - ${img.name}`}
                                loading="lazy"
                            />
                        </a>
                    ))}
                </div>
            </section>
        );
    }

    if (variant === 'compact') {
        const openJob = jobs.find((job) => job.id === openJobId);

        if (openJob) {
            return (
                <div className="gallery gallery-compact">
                    <button className="forma-btn gallery-compact-back" onClick={() => setOpenJobId(null)}>
                        All batches
                    </button>
                    {renderJobSection(openJob)}
                </div>
            );
        }

        const normalizedSearch = searchTerm.trim().toLowerCase();
        const visibleJobs = jobs.filter((job) =>
            `${job.id} ${job.status}`.toLowerCase().includes(normalizedSearch)
        );
        if (sortOrder === 'oldest') visibleJobs.reverse();
        if (sortOrder === 'name') visibleJobs.sort((a, b) => a.id.localeCompare(b.id));

        return (
            <div className="gallery gallery-compact">
                {loading && <p className="gallery-note">Loading...</p>}
                {error && <p className="gallery-note gallery-error">Couldn't load images: {error}</p>}
                {!loading && !error && visibleJobs.length === 0 && (
                    <p className="gallery-note">No images found.</p>
                )}

                <div className="library-photo-grid">
                    {visibleJobs.map((job) => {
                        const previewImages = job.images.slice(0, PREVIEW_COUNT);
                        const overflowCount = job.images.length - PREVIEW_COUNT;

                        return (
                            <button
                                key={job.id}
                                type="button"
                                className="forma-card library-photo-card"
                                onClick={() => setOpenJobId(job.id)}
                            >
                                <div className="library-photo-thumbgrid">
                                    {previewImages.map((img, index) => (
                                        <div key={img.name} className="library-photo-thumb">
                                            <img src={img.url} alt="" loading="lazy" />
                                            {index === PREVIEW_COUNT - 1 && overflowCount > 0 && (
                                                <span className="library-photo-overflow">+{overflowCount}</span>
                                            )}
                                        </div>
                                    ))}
                                    <span
                                        className={`forma-badge library-photo-badge ${job.status === 'done' ? 'forma-badge-ready' : 'forma-badge-processing'
                                            }`}
                                    >
                                        {job.status}
                                    </span>
                                </div>
                                <div className="library-photo-name">Batch {job.id.slice(0, 8)}</div>
                                {/* The /jobs data has no created-at date or upload-vs-YouTube
                                    origin yet, so the design's date and UPLOAD/YOUTUBE badge
                                    show the job status instead. Swap in when the backend adds them. */}
                                <div className="library-photo-count">{job.images.length} images</div>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div className="gallery">
            <div className="gallery-head">
                {onBack && (
                    <button className="btn btn-ghost" onClick={onBack}>Back</button>
                )}
                <h2>Uploaded images</h2>
            </div>

            {loading && <p className="gallery-note">Loading...</p>}
            {error && <p className="gallery-note gallery-error">Couldn't load images: {error}</p>}
            {!loading && !error && jobs.length === 0 && (
                <p className="gallery-note">No images uploaded yet.</p>
            )}

            {jobs.map((job) => renderJobSection(job))}
        </div>
    );
}

// ----- End of Functions ----------------------------------------------------- //

export default ImageGallery;