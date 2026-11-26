# Web app: shell components (`TopNav`, `Sidebar`, `Dock`, `Walkthrough`)

These components frame every dashboard page. [App.jsx](App.md) mounts them. The layout follows the Genesis Figma designs, with a desktop layout and a mobile layout (760 px wide or less, from [useMobileView](utilities.md#usemobileviewjs)).

---

## `TopNav.jsx`
The top bar. Left to right: the **GENESIS logo** (opens Home), **search**, the **storage meter**, **help** (opens Feedback), **notifications** (a placeholder panel saying there are none yet) and the **avatar menu** (name and email, *Manage account*, plan and storage, a sound on/off toggle, and *Log out*, or *Sign in* for guests). In the phone layout (`isCompact`) it shows the logo, a search button that opens the search box in a row under the bar, notifications and the avatar. The storage meter and help are left out, and the avatar menu adds *Show walkthrough*, because phones have no Learn button.

**Props:** `user`, `isCompact`, `onGoHome`, `onOpenModel`, `onOpenLibrary`, `onOpenHelp`, `onOpenAccount`, `onShowWalkthrough`, `onSignOut`.

### Internals
- `MAX_SEARCH_RESULTS = 8`.
- **`initialsOf(name)`**: up to two initials for the avatar placeholder (*"Shaun Li"* gives *"SL"*), or `?`.
- **`useCloseOnOutsideClick(isOpen, ref, close)`**: while the popup is open, closes it on a `pointerdown` outside `ref` or on Escape.
- **`SearchBox({ onOpenModel, onOpenLibrary, autoFocus, onResultOpened })`**:
  - `loadJobs()` fetches `GET /api/v1/jobs` **each time the box gets focus**, so new work shows up. If the backend is unreachable, search simply finds nothing.
  - Results are jobs that are `done` (*3D model*) or have photos (*Source photos · N*), named with `jobDisplayName`, filtered by a case-insensitive substring match, at most 8.
  - The up and down arrow keys move the highlight (wrapping round). **Enter** opens the result: a model opens its model page, a photo batch opens the Library's Photos tab. Opening plays the `tap` sound.
- **`TopNav(...)`**: `openPopup` (`notifications` or `profile`, only one at a time), `isSearchOpen` (the phone search row). `togglePopup(name)` opens one popup and closes the other. The storage meter shows the plan's storage from [plans.js](utilities.md#plansjs).

---

## `Sidebar.jsx`
The left sidebar on wide screens. At the top, **New** opens a small menu with *Capture with camera* (`onNewModel`) and *Upload photos* (opens a hidden multi-file `<input>`; the chosen files go to `onAddPhotos`, and the input is cleared so choosing the same files again still fires). Below it are the workspace pages, and **Learn** at the bottom replays the walkthrough.
- `SIDEBAR_PAGES`: Home, Media Library, Photo Editor, Scene Builder, Video Extractor, Model Viewer, Feedback. Each has an icon and a short label under it.
- The New menu closes on a click outside it or on Escape.
- `activeTab` is highlighted. App passes `viewer` while the model page is open.

---

## `Dock.jsx`
The **phone tab bar** along the bottom. It shows **four tabs at a time**, each an icon with a short label, with **Capture raised** in the middle. An arrow button on the right slides to the next four tabs, and on the last four it points back to the first. The tabs can also be swiped.
- `DOCK_TABS`: Home, Library, **Capture** (`isRaised`; calls `onNewModel`), Editor, Scene, Video, Viewer, Feedback.
- **On a page change**, it scrolls to the set of four that contains the current page (found by `aria-current="page"`).
- `handleScroll` tracks `isAtLastTabs` to flip the arrow. `showNextTabs()` scrolls by one container width, or back to the start.
- `selectTab(id)`: Capture calls `onNewModel`, anything else `onNavigate(id)`.

---

## `Walkthrough.jsx`
The **first-run tour**. The page is dimmed and a glowing spotlight is drawn around one item at a time: Home's *Recent* section, then each sidebar item from top to bottom, or each dock item from left to right on phones. A tooltip shows the step count, title, text and **Skip / Next** (**Finish** on the last step). Escape skips.
- **`WALKTHROUGH_STEPS`**: each step has `targets` (CSS selectors; the first one found on the page is used, the sidebar's before the dock's), `title`, `text` (with `mobileText` and `guestText` variants) and `optional`. Optional steps are **left out when their item is not on screen**, for example *Add photos* and *Learn* on phones. Guests cannot save work, so their last step suggests signing in.
- Layout constants: padding 6, tooltip gap 14, tooltip width 276, screen margin 12.
- **`findTarget(step)`**: the first selector that matches.
- **`placementFor(element)`**: `right` for sidebar items, `above` for dock items, `below` otherwise (the top bar).
- **`showMobileDockPageWith(tab)`**: in the phone layout the dock shows four tabs at a time, so each step slides the dock to the set of four that holds its item. Finishing slides back to the set that holds the current page.
- **`Walkthrough({ isGuest, onClose })`**: `steps` is filtered once on mount. On every step it **measures** the target (`getBoundingClientRect`, also on resize and scroll) to place the spotlight and tooltip. If the item is not on screen, the tooltip goes in the middle of the page. `goToNextStep()` moves on or finishes, and `finish()` calls `onClose`.
