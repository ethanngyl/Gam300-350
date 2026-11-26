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
    grid: (<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>),
    cubePlus: (<><path d="m10 5 7 4v8l-7 4-7-4V9z" /><path d="m10 13-7-4M10 13l7-4M10 13v8" /><path d="M19 2v6M16 5h6" /></>),
    home: (<><path d="M3 11 12 3l9 8" /><path d="M5 10v10h5v-6h4v6h5V10" /></>),
    layers: (<><path d="M12 3 21 8 12 13 3 8z" /><path d="M3 12l9 5 9-5" /><path d="M3 16l9 5 9-5" /></>),
    edit: (<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>),
    shield: <path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6z" />,
    shapes: (<><path d="M12 3 16.5 10.5h-9z" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><circle cx="17" cy="17" r="3.5" /></>),
    play: (<><rect x="3" y="6" width="18" height="12" rx="3" /><path d="m10 9.5 4.5 2.5-4.5 2.5z" /></>),
    // Sidebar and top bar (app shell)
    sliders: (<><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></>),
    book: (<><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" /></>),
    help: (<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7" /><path d="M12 17h.01" /></>),
    bell: (<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>),
    creditCard: (<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>),
    database: (<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>),
    close: <path d="M18 6 6 18M6 6l12 12" />,
    mail: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
    externalLink: (<><path d="M15 3h6v6M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>),
    chevronRight: <path d="m9 6 6 6-6 6" />,
    film: (<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 7.5h4M3 12h4M3 16.5h4M17 7.5h4M17 12h4M17 16.5h4" /></>),
    monitor: (<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>),
    palette: (<><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.3-1.7-.4-1 .3-2.3 1.5-2.3H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>),
    folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
    // A lightning bolt: the camera's flash.
    flash: (<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />),
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
    settings: (<><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2.5" /><path d="M18.5 12L21.3 12M16.6 16.6L18.6 18.6M12 18.5L12 21.3M7.4 16.6L5.4 18.6M5.5 12L2.7 12M7.4 7.4L5.4 5.4M12 5.5L12 2.7M16.6 7.4L18.6 5.4" strokeWidth="2.6" /></>),
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
    trash: (<><path d="M4 7h16M10 7V4h4v3" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>),
    check: <path d="m5 12 5 5 9-10" />,
    volume: (<><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>),
    volumeOff: (<><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 6 6M22 9l-6 6" /></>),
    link: (<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" /></>),
    video: (<><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3" /></>),
    upload: (<><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></>),
    message: (<><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /><path d="M8 10h8M8 13h5" /></>),
    lock: (<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
    send: (<><path d="M21 3 10 14" /><path d="m21 3-7 18-4-7-7-4z" /></>),
    arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
    download: (<><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 19h14" /></>),
    fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
    // Phone layouts
    more: (<><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></>),
    eyeOff: (<><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.7M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>),
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