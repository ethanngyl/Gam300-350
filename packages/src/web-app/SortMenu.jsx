/*!************************************************************************
\file SortMenu.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
The Media Library's sort control, in place of the browser's own
drop-down: a button showing the current order ("Newest") that opens a
small menu in the app's style, with a tick on the chosen order. On phones
the button is just the icon, beside the search box. The menu closes on a
choice, a click outside it or Escape; arrow keys move between the choices.
- SortMenu({ options, value, onChange })
React component. options: [{ id, label }]; value: the chosen id;
onChange(id) when another is picked.
**************************************************************************/

import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { playSound } from '../audio/Audio.js';

function SortMenu({ options, value, onChange }) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);
    const optionRefs = useRef([]);
    const chosenOption = options.find((option) => option.id === value) ?? options[0];

    // Closes on a click outside or Escape; focuses the chosen order on open.
    useEffect(() => {
        if (!isOpen) return undefined;
        optionRefs.current[options.indexOf(chosenOption)]?.focus();
        function closeOnOutsideClick(event) {
            if (!containerRef.current?.contains(event.target)) setIsOpen(false);
        }
        function closeOnEscape(event) {
            if (event.key === 'Escape') setIsOpen(false);
        }
        document.addEventListener('pointerdown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isOpen, options, chosenOption]);

    function choose(optionId) {
        playSound('tap');
        setIsOpen(false);
        if (optionId !== value) onChange(optionId);
    }

    // Up / Down move between the choices.
    function handleOptionKeyDown(event, index) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        optionRefs.current[(index + step + options.length) % options.length]?.focus();
    }

    return (
        <div className="sort-menu" ref={containerRef}>
            <button
                type="button"
                className="sort-menu-button"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-label={`Sort: ${chosenOption.label}`}
                onClick={() => {
                    playSound('tap');
                    setIsOpen((wasOpen) => !wasOpen);
                }}
            >
                <Icon name="filter" size={14} />
                <span className="sort-menu-label">{chosenOption.label}</span>
                <span className="sort-menu-chevron"><Icon name="chevron" size={14} /></span>
            </button>

            {isOpen && (
                <div className="app-menu sort-menu-list" role="menu" aria-label="Sort by">
                    <p className="app-menu-heading">Sort by</p>
                    {options.map((option, index) => {
                        const isChosen = option.id === chosenOption.id;
                        return (
                            <button
                                key={option.id}
                                ref={(element) => { optionRefs.current[index] = element; }}
                                type="button"
                                role="menuitemradio"
                                aria-checked={isChosen}
                                className={isChosen ? 'app-menu-item is-compact is-chosen' : 'app-menu-item is-compact'}
                                onClick={() => choose(option.id)}
                                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                            >
                                <span className="sort-menu-option">{option.label}</span>
                                {isChosen && <Icon name="check" size={15} />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default SortMenu;