/*!************************************************************************
\file menuPosition.js
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 20-10-2026
\brief
Where to open a ContextMenu for a contextmenu event. Kept out of
ContextMenu.jsx so that file only exports components (fast refresh).
**************************************************************************/

// The keyboard menu key reports (0, 0), so the element's corner is used instead.
export function menuPosition(event) {
    if (event.clientX === 0 && event.clientY === 0) {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: rect.left + 12, y: rect.top + 12 };
    }
    return { x: event.clientX, y: event.clientY };
}
