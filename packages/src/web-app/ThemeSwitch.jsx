/*!************************************************************************
\file ThemeSwitch.jsx
\par Course: csd3401f26
\par Software Engineering Project 5
\date 10-11-2026
\brief
Three-way Light / Dark / System switch for the app's appearance
(ThemePreference.js). Shown in the sidebar footer and on the Account
page's Appearance section.
- isCompact: a single button that steps through the three (the collapsed
  sidebar), with the current choice as its icon.
**************************************************************************/

import Icon from './Icons.jsx';
import { setThemePreference, useThemePreference } from './ThemePreference.js';
import { playSound } from '../audio/Audio.js';

const OPTIONS = [
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
    { id: 'system', label: 'System', icon: 'monitor' },
];

function ThemeSwitch({ isCompact = false, className = '' }) {
    const { preference } = useThemePreference();

    // Collapsed sidebar: one button that steps Light -> Dark -> System.
    if (isCompact) {
        const index = OPTIONS.findIndex((option) => option.id === preference);
        const current = OPTIONS[index];
        const next = OPTIONS[(index + 1) % OPTIONS.length];
        return (
            <button
                type="button"
                className={['theme-switch-cycle', className].filter(Boolean).join(' ')}
                title={`Appearance: ${current.label} (switch to ${next.label})`}
                aria-label={`Appearance: ${current.label}. Switch to ${next.label}`}
                onClick={() => {
                    playSound('tap');
                    setThemePreference(next.id);
                }}
            >
                <Icon name={current.icon} size={16} />
            </button>
        );
    }

    return (
        <div
            className={['theme-switch', className].filter(Boolean).join(' ')}
            role="radiogroup"
            aria-label="Appearance"
        >
            {OPTIONS.map((option) => (
                <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={preference === option.id}
                    className={preference === option.id ? 'theme-switch-option is-active' : 'theme-switch-option'}
                    title={option.label}
                    onClick={() => {
                        if (preference === option.id) return;
                        playSound('tap');
                        setThemePreference(option.id);
                    }}
                >
                    <Icon name={option.icon} size={14} />
                    <span>{option.label}</span>
                </button>
            ))}
        </div>
    );
}

export default ThemeSwitch;
