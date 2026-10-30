/*!************************************************************************
\file TrainingQualitySlider.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 27-10-2026
\brief
"Model detail" slider with three stops (Fast / Normal / Detailed) that
sets the training iteration cap for a new model. The stop labels under
the slider can also be clicked. iterations is the current cap and
onChange gets the new one; see TrainingPresets.js for the values.
**************************************************************************/

import { playSound } from '../audio/Audio.js';
import { TRAINING_PRESETS } from './TrainingPresets.js';

// Index of the "Normal" stop, used if iterations matches no preset.
const NORMAL_PRESET_INDEX = 1;

// The dot between the preset name and the count is written as an escape so
// this file stays plain ASCII (an editor saving it as ANSI broke the build).

function TrainingQualitySlider({ iterations, onChange, disabled = false }) {
    const matchingIndex = TRAINING_PRESETS.findIndex((preset) => preset.iterations === iterations);
    const selectedIndex = matchingIndex === -1 ? NORMAL_PRESET_INDEX : matchingIndex;
    const selectedPreset = TRAINING_PRESETS[selectedIndex];

    function choosePreset(index) {
        if (index === selectedIndex) return;
        playSound('tap');
        onChange(TRAINING_PRESETS[index].iterations);
    }

    return (
        <div className={disabled ? 'training-quality is-disabled' : 'training-quality'}>
            <div className="training-quality-head">
                <span>Model detail</span>
                <span className="training-quality-value">
                    {selectedPreset.label}{' \u00B7 '}{selectedPreset.iterations.toLocaleString()} iterations
                </span>
            </div>
            <input
                type="range"
                className="training-quality-range"
                min={0}
                max={TRAINING_PRESETS.length - 1}
                step={1}
                value={selectedIndex}
                onChange={(event) => choosePreset(Number(event.target.value))}
                disabled={disabled}
                aria-label="Model detail"
                aria-valuetext={`${selectedPreset.label}, ${selectedPreset.iterations} iterations`}
            />
            <div className="training-quality-stops">
                {TRAINING_PRESETS.map((preset, index) => (
                    <button
                        key={preset.id}
                        type="button"
                        className={index === selectedIndex ? 'training-quality-stop is-active' : 'training-quality-stop'}
                        onClick={() => choosePreset(index)}
                        disabled={disabled}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

export default TrainingQualitySlider;