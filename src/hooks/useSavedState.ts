import { useState } from "react";

export function useSavedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
    const [state, setStateRaw] = useState<T>(() => {
        try {
            const stored = localStorage.getItem(key);
            return stored !== null ? (JSON.parse(stored) as T) : defaultValue;
        } catch {
            return defaultValue;
        }
    });

    function setState(value: T | ((prev: T) => T)) {
        setStateRaw(prev => {
            const next = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
            try {
                localStorage.setItem(key, JSON.stringify(next));
            } catch {
                // storage quota exceeded — proceed without persisting
            }
            return next;
        });
    }

    return [state, setState];
}
