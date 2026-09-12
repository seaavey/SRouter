export function formatTime(
    ms: number,
    intervalMsOrIncludeSeconds: number | boolean = 0,
    includeSeconds = false
): string {
    const intervalMs =
        typeof intervalMsOrIncludeSeconds === "number" ? intervalMsOrIncludeSeconds : 0;
    const shouldIncludeSeconds =
        typeof intervalMsOrIncludeSeconds === "boolean"
            ? intervalMsOrIncludeSeconds
            : includeSeconds;

    if (intervalMs >= 86_400_000) {
        return new Date(ms).toLocaleDateString([], {
            day: "2-digit",
            month: "short"
        });
    }

    return new Date(ms).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        ...(shouldIncludeSeconds ? { second: "2-digit" } : {})
    });
}

export function formatTimeUnit(intervalMs: number): string {
    if (intervalMs >= 86_400_000) return "day";
    if (intervalMs >= 3_600_000) return "hour";
    return "min";
}

export function formatDuration(ms: number): string {
    if (ms >= 1_000) {
        return `${(ms / 1_000).toLocaleString([], { maximumFractionDigits: 1 })} s`;
    }

    return `${ms.toLocaleString()} ms`;
}
