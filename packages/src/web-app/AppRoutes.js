/*!************************************************************************
\file AppRoutes.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
The address-bar hash for each page of the app, so the browser's Back and
Forward buttons move between pages (App.jsx keeps the two in step) and a
refresh stays on the same page. Hash URLs need nothing from the server:
every page is still served from "/".
  #/home, #/library, #/library/photos, #/editor, #/scene, #/viewer,
  #/youtube, #/capture, #/account, #/feedback  -- pages in the shell
  #/processing/<jobId>  -- a model being built
  #/model/<jobId>       -- a finished model in the full-page viewer
  #/viewer/file         -- a .ply opened from the user's computer
- viewToHash(view)
The hash for { activeTab, librarySubTab, screen, jobId }.
- hashToView(hash)
The view for a hash. Anything unknown or malformed is Home.
**************************************************************************/

// Pages shown inside the shell (App's activeTab).
const TABS = ['home', 'library', 'editor', 'scene', 'viewer', 'youtube', 'capture', 'account', 'feedback'];
// Same rule as the backend's job ids (scan.js JOB_ID_RE).
const JOB_ID_RE = /^[\w-]+$/;

const HOME = { activeTab: 'home', librarySubTab: 'models', screen: null, jobId: null };

export function viewToHash({ activeTab, librarySubTab, screen, jobId }) {
    if (screen === 'processing' && jobId) return `#/processing/${jobId}`;
    if (screen === 'result' && jobId) return `#/model/${jobId}`;
    if (screen === 'local-model') return '#/viewer/file';
    if (activeTab === 'library' && librarySubTab === 'photos') return '#/library/photos';
    return `#/${activeTab}`;
}

export function hashToView(hash) {
    const [page, detail, ...rest] = (hash || '').replace(/^#\/?/, '').split('/');
    if (rest.length > 0) return HOME;

    if (page === 'processing' || page === 'model') {
        if (!detail || !JOB_ID_RE.test(detail)) return HOME;
        return { ...HOME, screen: page === 'processing' ? 'processing' : 'result', jobId: detail };
    }
    if (page === 'viewer' && detail === 'file') return { ...HOME, activeTab: 'viewer', screen: 'local-model' };
    if (page === 'library' && (!detail || detail === 'photos'))
        return { ...HOME, activeTab: 'library', librarySubTab: detail === 'photos' ? 'photos' : 'models' };
    if (TABS.includes(page) && !detail) return { ...HOME, activeTab: page };
    return HOME;
}
