# Web app: main pages

These are the dashboard pages [App.jsx](App.md) switches between, plus the signed-out landing page. Each page fetches its own data from the backend API. The Photo Editor, Scene Builder, Capture, Processing, Frame Extractor, Account and Feedback pages have their own documents (see the [index](README.md)).

---

## `LandingScreen.jsx`
The page signed-out visitors see first, laid out like the Genesis landing design. From top to bottom:
- a top bar with the logo, links to Product, Gallery and Plans, **Log in** and **Get started**;
- the headline, with photos on the left turning into a model on the right (`HERO_PHOTOS` and `HERO_DOT_COUNT = 12` animated dots);
- the three `STEPS`;
- **Inside Genesis** (`FEATURES`: the Photo Editor, Media Library and Scene Builder screenshots, plus a line about the Video Extractor);
- **Made with Genesis** (`GALLERY`);
- **Plans** (from `plans.js`);
- a closing call to action, and the footer.

The pictures are the project's own (`landing/`): screenshots of the real app, renders of the cat statue sample, and photos from the sample set.
- **`scrollToSection(id)`**: smooth scroll for the nav links.
- **`LandingScreen({ onLogIn, onGetStarted })`**: `logIn()` and `getStarted()` play a tap sound and call the matching prop. *Get started* opens the login screen in create-account mode.

---

## `HomeScreen.jsx`
The dashboard's start page. It has a **Get Started** banner with three `START_ACTIONS`:
- *Add photos* opens [AddPhotosDialog](components.md#addphotosdialogjsx), which hands the photos to the Photo Editor through `onEditPhotos`;
- *Frames from video* opens the Video Extractor;
- *Build a scene* opens the Scene Builder.

Below that is **Recent**, with two tabs (`RECENT_TABS`) and a *View all* link. On phones only Recent is shown.
- **Your files**: the latest photo batches (`RECENT_ITEM_COUNT = 10`), each tagged by **`fileStatus(job)`** as *Source photos · N*, *Processing*, *Failed · N photos* or *Cancelled · N photos*. (Failed and cancelled builds used to show as *Processing* forever.) Opens the Photo Library.
- **Generated models**: the latest finished models, which open the model page.
- Both come from **`GET /api/v1/jobs`**. Thumbnails use `smallPhotoUrl`. With nothing made yet, a single *Create your first 3D model* card is shown instead.
- **`formatTimeAgo(ts)`**: *Just now*, *5m ago*, *3h ago*, *Yesterday*, *4d ago*, or a short date.
- `openItem(item)`, `startNewModel()`, `startAction(id)`.

---

## `LibraryScreen.jsx`
The **Media Library**, with two sub-views. The active one is controlled by the parent (`subTab` / `onSubTabChange`), so other pages can open either one directly.
- **3D Models**: a searchable, sortable grid built from `GET /api/v1/jobs`. Finished jobs show as **Ready**, running jobs as **Processing**, and **failed or cancelled jobs are hidden**. Each card shows [ModelCover](components.md#modelcoverjsx). Clicking a Ready card, or pressing Enter on it, opens the model page. **Right-clicking** opens a [ContextMenu](components.md#contextmenujsx) with Rename and Delete.
- **Photo Library**: embeds [ImageGallery](components.md#imagegalleryjsx) in its compact form.
- Both share the search box and [SortMenu](components.md#sortmenujsx), using `SORT_OPTIONS`: Newest, Oldest, Last edited, Name.
- **`lastEditedTime(model)`**: `Date.parse(updatedAt ?? createdAt) || 0`. The v1 API sends these as **millisecond numbers**, and `Date.parse` expects a date string, so check that the *Last edited* sort orders correctly.
- **`openModelMenu(event, model)`**: places the menu with `menuPosition`.
- **`openRenameDialog(model)`**: an [ActionDialog](components.md#actiondialogjsx) with an input. It explains that the engine samples `.ply` is renamed too, and that an empty name restores the default. It calls `renameJob` and updates the card in place.
- **`openDeleteDialog(model)`**: a dangerous-action confirmation that says how many source photos go too (and, for unfinished models, that processing stops). It calls `deleteJob` and removes the card.

---

## `ModelViewerScreen.jsx`
The **Model Viewer** tab: choose a model to open. It shows every finished model from `GET /api/v1/jobs` as a searchable grid of `ModelCover` cards, plus an **Open model file** button that loads a Gaussian splat `.ply` or a Wavefront `.obj` from the user's computer. Opening is left to the parent: `onOpenModel(jobId)` or `onOpenFile(file)` (`handleFileChange`).

---

## `ModelScreen.jsx`
The **page for one 3D model**, shown inside the dashboard (the dock stays).

**Props:** `jobId` (a server model) or `localFile` (`{ url, name, sizeBytes }`), `backLabel`, `showNamePrompt`, `onNamePromptClose`, `onBack`, `onOpenPhotos`, `onAddToScene`, `onDeleted`.

- **Header:** a back link, the name (with a pencil to rename), a *Ready* badge, when it was made (`formatCreatedDate`) and how many photos it used. Buttons: **Download .ply**, **Export .obj** ([ExportObjDialog](components.md#exportobjdialogjsx), the engine's OBJ export running in the browser), and **Add to scene**.
- **Viewer:** [SplatViewer](viewers.md#splatviewerjsx), embedded, with its renderer and view controls and a full-screen button (`toggleFullScreen`). A local `.obj` uses [ObjViewer](viewers.md#objviewerjsx) instead, with its vertex and triangle counts.
- **Side panel**, or below the viewer on phones:
  - **Details**: photos, background removal, splat count, file size (`formatFileSize`) and file format, read with **`readPlyInfo(url)`**, which fetches only 4 KB;
  - **Source photos**: up to `PHOTO_PREVIEW_COUNT = 7` thumbnails, plus *Open in Media Library*;
  - **Manage**: Rename and Delete, using the Library's dialogs and the `mediaApi` calls.
- **Data:** `GET /api/v1/jobs` (for the summary and images) and `GET /api/v1/jobs/:id` (for details such as `removeBackground`).
- **A local `.ply`** shows only the viewer, its file details and Export .obj.
- **On phones** it follows the mobile Figma: a header with a back button and a menu, then the viewer, the name and badge, a row of Photos, Size and Format, the actions, and the photos.
- **Right after a build** (`showNamePrompt`), [NameModelPrompt](components.md#namemodelpromptjsx) asks for the model's name first.
