import { useCallback, useRef, useState } from "react";

/**
 * Copy a string to the clipboard and track the most recently copied value.
 * Returns [copied, copy] where `copied` is the last copied text (null when
 * nothing has been copied yet) — callers compare it to the item's own id to
 * show a transient "copied" state.
 */
export function useCopy() {
    const [copied, setCopied] = useState<string | null>(null);
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const copy = useCallback(async (text: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(text);
        if (resetTimer.current) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setCopied(null), 1500);
    }, []);

    return { copied, copy };
}
