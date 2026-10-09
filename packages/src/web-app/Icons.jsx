/*!************************************************************************
\file Icons.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-10-2026
\brief
Small set of inline SVG line icons used across the dashboard, so the UI
matches the design without relying on unicode symbols or an icon package.
Usage: <Icon name="layers" size={16} />
**************************************************************************/

const ICON_PATHS = {
    cube: (<><path d="m12 2 9 5v10l-9 5-9-5V7z" /><path d="m12 12-9-5M12 12l9-5M12 12v10" /></>),
    home: (<><path d="M3 11 12 3l9 8" /><path d="M5 10v10h5v-6h4v6h5V10" /></>),
    layers: (<><path d="M12 3 21 8 12 13 3 8z" /><path d="M3 12l9 5 9-5" /><path d="M3 16l9 5 9-5" /></>),
    edit: (<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>),
    shield: <path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6z" />,
    play: (<><rect x="3" y="6" width="18" height="12" rx="3" /><path d="m10 9.5 4.5 2.5-4.5 2.5z" /></>),
    folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
    image: (<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 9" /></>),
    search: (<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
    filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    camera: (<><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>),
    sparkle: <path d="M12 2c.8 6 2 7.2 8 8-6 .8-7.2 2-8 8-.8-6-2-7.2-8-8 6-.8 7.2-2 8-8z" />,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    user: (<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>),
    logout: (<><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" /><path d="m16 8 4 4-4 4M20 12H9" /></>),
    move: <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />,
    crop: (<><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M2 6h14a2 2 0 0 1 2 2v14" /></>),
    wand: (<><path d="m4 20 11-11" /><path d="m14 6 4 4" /><path d="M6 3v3M4.5 4.5h3M19 14v3M17.5 15.5h3" /></>),
    moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
    refresh: (<><path d="M20 11a8 8 0 0 0-14-4L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14 4l2-2" /><path d="M20 20v-5h-5" /></>),
    settings: (<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>),
    eye: (<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
    triangle: <path d="M12 4 21 19H3z" />,
    target: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>),
    sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>),
    skipBack: (<><path d="M6 5v14" /><path d="M19 5 9 12l10 7z" /></>),
    stepBack: <path d="M15 5 7 12l8 7z" />,
    playSolid: <path d="M7 4v16l13-8z" fill="currentColor" />,
    pause: (<><rect x="6" y="5" width="4" height="14" fill="currentColor" /><rect x="14" y="5" width="4" height="14" fill="currentColor" /></>),
    stepForward: <path d="m9 5 8 7-8 7z" />,
    skipForward: (<><path d="M18 5v14" /><path d="m5 5 10 7-10 7z" /></>),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
};

function Icon({ name, size = 16 }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {ICON_PATHS[name]}
        </svg>
    );
}

export default Icon;