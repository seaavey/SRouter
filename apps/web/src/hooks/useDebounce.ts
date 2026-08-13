import { useEffect, useState } from "react";

/**
 * Returns a value that lags the input by `delayMs`, for client-side
 * search/filter inputs that would otherwise re-render on every keystroke.
 */
export function useDebounce<T>(value: T, delayMs = 200): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);

    return debounced;
}
