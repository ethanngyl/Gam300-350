/*!************************************************************************
\file ImageGallery.jsx
\author1 Bryan
\author2 Gabriel Sebastian Putra
\par DP email1: 
\par DP email2: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 30-09-2026
\brief
React page that shows every photo stored under backend/jobs/<jobId>/images,
grouped by job. It fetches the job list once when it opens and shows a
section per job with its short id, status, photo count and a grid of
thumbnails. Clicking a thumbnail downloads that photo.
- ImageGallery({ onBack })
The gallery component. Loads the jobs, then renders a loading, error or
empty message, or one section per job.
- load()
Fetches GET /jobs and stores the result in state. Ignores the response if
the user left the page before it arrived.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { useEffect, useState } from 'react';
import './ImageGallery.css';

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Shows every photo stored under backend/jobs/<jobId>/images, grouped by
    job. Data comes from GET /jobs (list) and GET /jobs/:id/images/:name
    (each image).
  \param onBack
    function
    Called when the Back button is clicked
  \return
    The gallery page
*/
/************************************************************************/
function ImageGallery({ onBack }) {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

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
            ))}
        </div>
    );
}

// ----- End of Functions ----------------------------------------------------- //

export default ImageGallery;
