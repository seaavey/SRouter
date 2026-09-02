export function formatTime(ms: number, includeSeconds = false): string {
    return new Date(ms).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        ...(includeSeconds ? { second: "2-digit" } : {})
    });
}

export function formatTimeUnit(intervalMs: number): string {
    if (intervalMs >= 86_400_000) return "day";
    if (intervalMs >= 3_600_000) return "hour";
    return "min";
}