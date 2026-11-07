/*!************************************************************************
\file catalog.js
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-11-2026
\brief
The website's reference data (feedback categories and message limits,
training presets, the photo minimum, upload limits), read once from
GET /api/v1/catalog. The data itself lives in the backend's
catalog/catalog.json and config, so the website keeps no copies of it.
The module waits for the reply (top-level await), so every module that
imports it, directly or through FeedbackCategories.js / TrainingPresets.js /
mediaJobs.js, can read the values as plain constants. If the server can't
be reached after a few tries, the page says so with a Retry button.
- catalog
{ version, minPhotos, feedbackCategories, feedbackMessage,
trainingPresets, defaultTrainingPreset, limits } (frozen).
**************************************************************************/

const CATALOG_URL = '/api/v1/catalog';
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// ----- Start of Functions --------------------------------------------------- //

// The catalog, trying a few times so a server that is just starting is waited for.
async function fetchCatalog() {
    let lastError = null;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
            const res = await fetch(CATALOG_URL, { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (error) {
            lastError = error;
            if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
    }
    throw lastError;
}

// The app can't start without its reference data, so say why instead of a blank page.
function showUnreachable(error) {
    const root = document.getElementById('root') ?? document.body;
    root.innerHTML = `
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
                    background:#0d0d14;color:#f4fbfd;font:15px system-ui,sans-serif;padding:16px;text-align:center">
            <div>
                <p style="margin:0 0 12px">Couldn't reach the server, so the app can't start.</p>
                <p style="margin:0 0 16px;opacity:.7;font-size:13px">Make sure the backend is running, then try again.</p>
                <button type="button" style="padding:8px 16px;border-radius:6px;border:0;cursor:pointer">Retry</button>
            </div>
        </div>`;
    root.querySelector('button').addEventListener('click', () => window.location.reload());
    console.error('Could not load the catalog:', error);
}

// ----- End of Functions ----------------------------------------------------- //

let data;
try {
    data = await fetchCatalog();
} catch (error) {
    showUnreachable(error);
    throw error;
}

export const catalog = Object.freeze(data);
