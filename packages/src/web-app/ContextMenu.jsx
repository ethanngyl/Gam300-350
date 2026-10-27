/*!************************************************************************
\file ContextMenu.jsx
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 20-10-2026
\brief
Right-click menu used by the Media Library. The parent keeps the open
menu in state ({ x, y, items }) and renders <ContextMenu> while it is set.
The menu is drawn in a portal so card overflow can't clip it, is kept
inside the window, and closes on a click outside, Escape, scroll, resize
or when an item is chosen.
Open it at menuPosition(event) from menuPosition.js.
- ContextMenu({ x, y, items, onClose })
items: [{ label, icon, danger, onSelect }]
**************************************************************************/

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

const EDGE_GAP = 8;

function ContextMenu({ x, y, items, onClose }) {
    const menuRef = useRef(null);
    const [position, setPosition] = useState({ left: x, top: y });

    // Flip the menu back inside the window when it would run off an edge.
    useLayoutEffect(() => {
        const rect = menuRef.current.getBoundingClientRect();
        setPosition({
            left: Math.max(EDGE_GAP, Math.min(x, window.innerWidth - rect.width - EDGE_GAP)),
            top: Math.max(EDGE_GAP, Math.min(y, window.innerHeight - rect.height - EDGE_GAP)),
        });
        menuRef.current.querySelector('button')?.focus();
    }, [x, y]);

    useEffect(() => {
        function handlePointerDown(event) {
            if (!menuRef.current.contains(event.target)) onClose();
        }
        function handleKeyDown(event) {
            if (event.key === 'Escape') onClose();
        }
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        // Capture so scrolling any inner panel closes it too.
        window.addEventListener('scroll', onClose, true);
        window.addEventListener('resize', onClose);
        window.addEventListener('blur', onClose);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('scroll', onClose, true);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('blur', onClose);
        };
    }, [onClose]);

    return createPortal(
        <div
            ref={menuRef}
            className="context-menu"
            role="menu"
            style={position}
            onContextMenu={(event) => event.preventDefault()}
        >
            {items.map((item) => (
                <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    className={item.danger ? 'context-menu-item is-danger' : 'context-menu-item'}
                    onClick={() => {
                        playSound('tap');
                        onClose();
                        item.onSelect();
                    }}
                >
                    {item.icon && <Icon name={item.icon} size={14} />}
                    {item.label}
                </button>
            ))}
        </div>,
        document.body
    );
}

export default ContextMenu;
