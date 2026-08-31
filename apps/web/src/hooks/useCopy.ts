import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

export function useCopy() {
    const [copied, setCopied] = useState<string | null>(null);
    const reset_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const copy = useCallback(async (text: string, message?: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(text);
            if (message) {
                toast.success(message);
            }
            if (reset_timer.current) clearTimeout(reset_timer.current);
            reset_timer.current = setTimeout(() => setCopied(null), 1500);
        } catch {
            toast.error("Failed to copy to clipboard");
        }
    }, []);

    return { copied, copy };
}
