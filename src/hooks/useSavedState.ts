import { useState } from "react";

export function useSavedState<T>(key: string, defaultValue: T): [T, (value: T) => void] {
    const [state, setStateRaw] = useState<T>(() => {
        try {
            const stored = localStorage.getItem(key);
            return stored !== null ? (JSON.parse(stored) as T) : defaultValue;
        } catch {
            return defaultValue;
        }
    });

    function setState(value: T) {
        setStateRaw(value);
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // storage quota exceeded — proceed without persisting
        }
    }

    return [state, setState];
}
