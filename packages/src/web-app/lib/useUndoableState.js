/*!************************************************************************
\file useUndoableState.js
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 26-10-2026
\brief
React state with an undo history, used for the Scene Builder's objects.
- useUndoableState(initialValue)
Returns { value, set, undo, redo, reset, canUndo, canRedo }.
set(updater, { mergeKey }) takes a value or an updater function like a
React state setter and records the previous value for undo. Changes that
pass the same mergeKey one after another become a single undo step (e.g.
every keystroke while typing in one field). A change that returns the same
value records nothing. Any new change clears the redo steps. reset(value)
replaces the value and clears the history. At most MAX_HISTORY steps are
kept.
**************************************************************************/

import { useCallback, useState } from 'react';

const MAX_HISTORY = 100;

export function useUndoableState(initialValue) {
    const [history, setHistory] = useState(() => ({
        past: [],
        present: initialValue,
        future: [],
        lastMergeKey: null,
    }));

    const set = useCallback((updater, { mergeKey = null } = {}) => {
        setHistory((current) => {
            const next = typeof updater === 'function' ? updater(current.present) : updater;
            if (next === current.present) return current;
            const isMerged = mergeKey !== null && mergeKey === current.lastMergeKey;
            return {
                past: isMerged ? current.past : [...current.past, current.present].slice(-MAX_HISTORY),
                present: next,
                future: [],
                lastMergeKey: mergeKey,
            };
        });
    }, []);

    const undo = useCallback(() => {
        setHistory((current) => {
            if (current.past.length === 0) return current;
            return {
                past: current.past.slice(0, -1),
                present: current.past[current.past.length - 1],
                future: [current.present, ...current.future],
                lastMergeKey: null,
            };
        });
    }, []);

    const redo = useCallback(() => {
        setHistory((current) => {
            if (current.future.length === 0) return current;
            return {
                past: [...current.past, current.present].slice(-MAX_HISTORY),
                present: current.future[0],
                future: current.future.slice(1),
                lastMergeKey: null,
            };
        });
    }, []);

    const reset = useCallback((value) => {
        setHistory({ past: [], present: value, future: [], lastMergeKey: null });
    }, []);

    return {
        value: history.present,
        set,
        undo,
        redo,
        reset,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
    };
}
